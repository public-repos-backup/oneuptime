import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';

import { OnCreate, OnDelete } from '../Types/Database/Hooks';
import MonitorService from './MonitorService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import PositiveNumber from 'Common/Types/PositiveNumber';
import CreateBy from '../Types/Database/CreateBy';
import UserService from './UserService';
import User from 'Model/Models/User';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from '../Types/Database/QueryHelper';
import Semaphore from '../Infrastructure/Semaphore';

export class Service extends DatabaseService<MonitorStatusTimeline> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorStatusTimeline, postgresDatabase);
        this.hardDeleteItemsOlderThanInDays('createdAt', 120);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<MonitorStatusTimeline>
    ): Promise<OnCreate<MonitorStatusTimeline>> {
        if (!createBy.data.monitorId) {
            throw new BadDataException('monitorId is null');
        }

        const mutexId: ObjectID = await Semaphore.lock({
            key: createBy.data.monitorId.toString(),
        });

        if (!createBy.data.startsAt) {
            createBy.data.startsAt = OneUptimeDate.getCurrentDate();
        }

        if (
            (createBy.data.createdByUserId ||
                createBy.data.createdByUser ||
                createBy.props.userId) &&
            !createBy.data.rootCause
        ) {
            let userId: ObjectID | undefined = createBy.data.createdByUserId;

            if (createBy.props.userId) {
                userId = createBy.props.userId;
            }

            if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
                userId = createBy.data.createdByUser.id;
            }

            const user: User | null = await UserService.findOneBy({
                query: {
                    _id: userId?.toString() as string,
                },
                select: {
                    _id: true,
                    name: true,
                    email: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (user) {
                createBy.data.rootCause = `Monitor status created by ${user.name} (${user.email})`;
            }
        }

        const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
            await this.findOneBy({
                query: {
                    monitorId: createBy.data.monitorId,
                },
                sort: {
                    createdAt: SortOrder.Descending,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                },
            });

        return {
            createBy,
            carryForward: {
                lastMonitorStatusTimelineId:
                    lastMonitorStatusTimeline?.id || null,
                mutexId: mutexId,
            },
        };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<MonitorStatusTimeline>,
        createdItem: MonitorStatusTimeline
    ): Promise<MonitorStatusTimeline> {
        if (!createdItem.monitorId) {
            throw new BadDataException('monitorId is null');
        }

        if (!createdItem.monitorStatusId) {
            throw new BadDataException('monitorStatusId is null');
        }

        // update the last status as ended.

        if (onCreate.carryForward.lastMonitorStatusTimelineId) {
            await this.updateOneById({
                id: onCreate.carryForward.lastMonitorStatusTimelineId!,
                data: {
                    endsAt:
                        createdItem.createdAt || OneUptimeDate.getCurrentDate(),
                },
                props: {
                    isRoot: true,
                },
            });
        }

        await MonitorService.updateOneBy({
            query: {
                _id: createdItem.monitorId?.toString(),
            },
            data: {
                currentMonitorStatusId: createdItem.monitorStatusId,
            },
            props: onCreate.createBy.props,
        });

        if (onCreate.carryForward.mutexId) {
            const mutexId: ObjectID = onCreate.carryForward.mutexId;
            await Semaphore.release(mutexId);
        }

        return createdItem;
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<MonitorStatusTimeline>
    ): Promise<OnDelete<MonitorStatusTimeline>> {
        if (deleteBy.query._id) {
            const monitorStatusTimelineToBeDeleted: MonitorStatusTimeline | null =
                await this.findOneById({
                    id: new ObjectID(deleteBy.query._id as string),
                    select: {
                        monitorId: true,
                        startsAt: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            const monitorId: ObjectID | undefined =
                monitorStatusTimelineToBeDeleted?.monitorId;

            if (monitorId) {
                const monitorStatusTimeline: PositiveNumber =
                    await this.countBy({
                        query: {
                            monitorId: monitorId,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (monitorStatusTimeline.isOne()) {
                    throw new BadDataException(
                        'Cannot delete the only status timeline. Monitor should have at least one status timeline.'
                    );
                }

                // adjust times of other timeline events. get the state before this status timeline.

                if (monitorStatusTimelineToBeDeleted?.startsAt) {
                    const beforeState: MonitorStatusTimeline | null =
                        await this.findOneBy({
                            query: {
                                monitorId: monitorId,
                                startsAt: QueryHelper.lessThan(
                                    monitorStatusTimelineToBeDeleted?.startsAt
                                ),
                            },
                            sort: {
                                createdAt: SortOrder.Descending,
                            },
                            props: {
                                isRoot: true,
                            },
                            select: {
                                _id: true,
                                startsAt: true,
                            },
                        });

                    if (beforeState) {
                        const afterState: MonitorStatusTimeline | null =
                            await this.findOneBy({
                                query: {
                                    monitorId: monitorId,
                                    startsAt: QueryHelper.greaterThan(
                                        monitorStatusTimelineToBeDeleted?.startsAt
                                    ),
                                },
                                sort: {
                                    createdAt: SortOrder.Ascending,
                                },
                                props: {
                                    isRoot: true,
                                },
                                select: {
                                    _id: true,
                                    startsAt: true,
                                },
                            });

                        if (!afterState) {
                            // if there's nothing after then end date of before state is null.

                            await this.updateOneById({
                                id: beforeState.id!,
                                data: {
                                    endsAt: null as any,
                                },
                                props: {
                                    isRoot: true,
                                },
                            });
                        } else {
                            // if there's something after then end date of before state is start date of after state.

                            await this.updateOneById({
                                id: beforeState.id!,
                                data: {
                                    endsAt: afterState.startsAt!,
                                },
                                props: {
                                    isRoot: true,
                                },
                            });
                        }
                    }
                }
            }

            return { deleteBy, carryForward: monitorId };
        }

        return { deleteBy, carryForward: null };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<MonitorStatusTimeline>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<MonitorStatusTimeline>> {
        if (onDelete.carryForward) {
            // this is monitorId.
            const monitorId: ObjectID = onDelete.carryForward as ObjectID;

            // get last status of this monitor.
            const monitorStatusTimeline: MonitorStatusTimeline | null =
                await this.findOneBy({
                    query: {
                        monitorId: monitorId,
                    },
                    sort: {
                        createdAt: SortOrder.Descending,
                    },
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                        monitorStatusId: true,
                    },
                });

            if (
                monitorStatusTimeline &&
                monitorStatusTimeline.monitorStatusId
            ) {
                await MonitorService.updateOneBy({
                    query: {
                        _id: monitorId.toString(),
                    },
                    data: {
                        currentMonitorStatusId:
                            monitorStatusTimeline.monitorStatusId,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }

        return onDelete;
    }
}

export default new Service();
