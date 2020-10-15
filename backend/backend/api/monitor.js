/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const axios = require('axios');
const UserService = require('../services/userService');
const MonitorService = require('../services/monitorService');
const MonitorLogService = require('../services/monitorLogService');
const LighthouseLogService = require('../services/lighthouseLogService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');
const ScheduleService = require('../services/scheduleService');
const ProbeService = require('../services/probeService');
const Api = require('../utils/api');

const router = express.Router();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

// Route
// Description: Adding / Updating a new monitor to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check MonitorMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const projectId = req.params.projectId;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        data.createdById = req.user ? req.user.id : null;

        /* if (!data.componentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Component ID is required.',
            });
        } */

        if (
            data.resourceCategory &&
            typeof data.resourceCategory !== 'string'
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Resource Category ID is not of string type.',
            });
        }
        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is required.',
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Name is not of type string.',
            });
        }

        if (!data.type) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Type is required.',
            });
        }

        if (typeof data.type !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor type should be of type string.',
            });
        }

        if (
            data.type !== 'url' &&
            data.type !== 'device' &&
            data.type !== 'manual' &&
            data.type !== 'api' &&
            data.type !== 'server-monitor' &&
            data.type !== 'script'
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Monitor type should be url, manual, device or script.',
            });
        }
        if (!data.data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor data is required.',
            });
        }

        if (typeof data.data !== 'object') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor Data should be of type object.',
            });
        }

        if (data.type === 'url' || data.type === 'api') {
            if (!data.data.url) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `url` property of type string.',
                });
            }

            if (
                (data.type === 'url' || data.type === 'manual') &&
                typeof data.data.url !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `url` property of type string.',
                });
            }

            if (data.type === 'api') {
                try {
                    const headers = await Api.headers(
                        data.headers,
                        data.bodyType
                    );
                    const body = await Api.body(
                        data.text && data.text.length
                            ? data.text
                            : data.formData,
                        data.text && data.text.length ? 'text' : 'formData'
                    );
                    const payload = {
                        method: data.method,
                        url: data.data.url,
                    };
                    if (headers && Object.keys(headers).length) {
                        payload.headers = headers;
                    }
                    if (body && Object.keys(body).length) {
                        payload.data = body;
                    }
                    const apiResponse = await axios(payload);
                    const headerContentType =
                        apiResponse.headers['content-type'];
                    if (/text\/html/.test(headerContentType)) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                'API Monitor URL should not be a HTML page.',
                        });
                    }
                } catch (err) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            (err.response && err.response.statusText) ||
                            err.message ||
                            'Monitor url did not return a valid response.',
                    });
                }
            }
        }

        if (data.type === 'device') {
            if (data.type === 'deviceId' && !data.data.deviceId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `url` property of type string.',
                });
            }

            if (
                data.type === 'deviceId' &&
                typeof data.data.deviceId !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `Device ID` property of type string.',
                });
            }
        }

        if (data.type === 'script') {
            if (!data.data.script) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Monitor data should have a `script` property of type string.',
                });
            }
        }
        data.projectId = projectId;

        const monitor = await MonitorService.create(data);
        if (data.callScheduleId) {
            const schedule = await ScheduleService.findOneBy({
                _id: data.callScheduleId,
            });
            let monitors = schedule.monitorIds;
            if (monitors.length > 0) {
                monitors.push({ _id: monitor._id, name: monitor.name });
            } else {
                monitors = Array(monitor._id);
            }
            const scheduleData = {
                projectId: projectId,
                monitorIds: monitors,
            };
            await ScheduleService.updateOneBy(
                { _id: data.callScheduleId },
                scheduleData
            );
        }

        if (data.type === 'server-monitor') {
            const { stat: validUp, reasons } = await (monitor &&
            monitor.criteria &&
            monitor.criteria.up
                ? ProbeService.conditions(null, null, monitor.criteria.up)
                : { stat: false, reasons: [] });
            const { stat: validDown } = await (monitor &&
            monitor.criteria &&
            monitor.criteria.down
                ? ProbeService.conditions(null, null, monitor.criteria.down)
                : { stat: false });
            if (!validUp || validDown) {
                const handler = setTimeout(async () => {
                    const log = await MonitorLogService.findOneBy({
                        monitorId: monitor._id,
                    });
                    if (!log) {
                        await ProbeService.saveMonitorLog({
                            monitorId: monitor._id,
                            status: 'offline',
                            reason: reasons,
                        });
                    }
                    clearTimeout(handler);
                }, 3 * 60 * 1000);
            }
        }

        const user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(
            monitor.projectId._id,
            `A New Monitor was Created with name ${monitor.name} by ${user.name}`,
            user._id,
            'monitoraddremove'
        );
        await RealTimeService.sendMonitorCreated(monitor);
        return sendItemResponse(req, res, monitor);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const data = req.body;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }
            if (data.type && data.type === 'api') {
                try {
                    const headers = await Api.headers(
                        data.headers,
                        data.bodyType
                    );
                    const body = await Api.body(
                        data.text && data.text.length
                            ? data.text
                            : data.formData,
                        data.text && data.text.length ? 'text' : 'formData'
                    );
                    const payload = {
                        method: data.method,
                        url: data.data.url,
                    };
                    if (headers && Object.keys(headers).length) {
                        payload.headers = headers;
                    }
                    if (body && Object.keys(body).length) {
                        payload.data = body;
                    }
                    const apiResponse = await axios(payload);
                    const headerContentType =
                        apiResponse.headers['content-type'];
                    if (/text\/html/.test(headerContentType)) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                'API Monitor URL should not be a HTML page.',
                        });
                    }
                } catch (err) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            (err.response && err.response.statusText) ||
                            'Monitor url did not return a valid response.',
                    });
                }
            }
            let unsetData;
            if (!data.resourceCategory || data.resourceCategory === '') {
                unsetData = { resourceCategory: '' };
            }
            const monitor = await MonitorService.updateOneBy(
                { _id: req.params.monitorId },
                data,
                unsetData
            );
            if (monitor) {
                return sendItemResponse(req, res, monitor);
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor not found.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitors by projectId.
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        // Call the MonitorService.
        const monitors = await MonitorService.getMonitorsBySubprojects(
            subProjectIds,
            req.query.limit || 0,
            req.query.skip || 0
        );
        return sendItemResponse(req, res, monitors);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/monitor',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const monitors = await MonitorService.findBy(
                query,
                req.query.limit || 10,
                req.query.skip || 0
            );
            const count = await MonitorService.countBy({
                projectId: { $in: subProjectIds },
            });
            return sendListResponse(req, res, monitors, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/monitor/:monitorId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const monitorId = req.params.monitorId;
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { _id: monitorId, projectId: { $in: subProjectIds }, type }
                : { _id: monitorId, projectId: { $in: subProjectIds } };

            const monitor = await MonitorService.findOneBy(query);
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor logs by monitorId.
router.post(
    '/:projectId/monitorLogs/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const {
                skip,
                limit,
                startDate,
                endDate,
                probeValue,
                incidentId,
            } = req.body;
            const monitorId = req.params.monitorId;
            const query = {};
            if (monitorId && !incidentId) query.monitorId = monitorId;
            if (incidentId) query.incidentIds = incidentId;
            if (probeValue) query.probeId = probeValue;
            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            // Call the MonitorService.
            const monitorLogs = await MonitorLogService.findBy(
                query,
                limit || 10,
                skip || 0
            );
            const count = await MonitorLogService.countBy(query);
            return sendListResponse(req, res, monitorLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const monitor = await MonitorService.deleteBy(
                { _id: req.params.monitorId, projectId: req.params.projectId },
                req.user.id
            );
            if (monitor) {
                return sendItemResponse(req, res, monitor);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Monitor not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Adding / Updating a new monitor log
// Params:
// Param 1: req.params-> {projectId, monitorId}; req.body -> {[_id], data} <- Check MonitorLogModel for description.
// Returns: response status, error message
router.post(
    '/:projectId/log/:monitorId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const monitorId = req.params.monitorId || req.body._id;
            const data = req.body;
            data.monitorId = monitorId;

            const monitor = await MonitorService.findOneBy({ _id: monitorId });

            const {
                stat: validUp,
                reasons: upFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.up
                ? ProbeService.conditions(data, null, monitor.criteria.up)
                : { stat: false, reasons: [] });
            const {
                stat: validDegraded,
                reasons: degradedFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.degraded
                ? ProbeService.conditions(data, null, monitor.criteria.degraded)
                : { stat: false, reasons: [] });
            const {
                stat: validDown,
                reasons: downFailedReasons,
            } = await (monitor && monitor.criteria && monitor.criteria.down
                ? ProbeService.conditions(data, null, monitor.criteria.down)
                : { stat: false, reasons: [] });

            if (validDown) {
                data.status = 'offline';
                data.reason = upFailedReasons;
            } else if (validDegraded) {
                data.status = 'degraded';
                data.reason = upFailedReasons;
            } else if (validUp) {
                data.status = 'online';
                data.reason = [...degradedFailedReasons, ...downFailedReasons];
            } else {
                data.status = 'offline';
                data.reason = upFailedReasons;
            }

            const log = await ProbeService.saveMonitorLog(data);
            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor Logs by monitorId
router.post(
    '/:projectId/monitorLog/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { startDate, endDate } = req.body;
            const monitorId = req.params.monitorId;
            const monitorLogs = await MonitorService.getMonitorLogs(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Monitor Statuses by monitorId
router.post(
    '/:projectId/monitorStatuses/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { startDate, endDate } = req.body;
            const monitorId = req.params.monitorId;
            const monitorStatuses = await MonitorService.getMonitorStatuses(
                monitorId,
                startDate,
                endDate
            );
            return sendListResponse(req, res, monitorStatuses);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Lighthouse Logs by monitorId
router.get(
    '/:projectId/lighthouseLog/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { skip, limit, url } = req.query;
            const monitorId = req.params.monitorId;

            const {
                lighthouseLogs,
                count,
            } = await LighthouseLogService.findLastestScan({
                monitorId,
                url,
                limit: limit || 5,
                skip: skip || 0,
            });

            return sendListResponse(req, res, lighthouseLogs, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/lighthouseIssue/:issueId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const lighthouseIssue = await LighthouseLogService.findOneBy({
                _id: req.params.issueId,
            });

            return sendItemResponse(req, res, lighthouseIssue);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async function(req, res) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

router.get(
    '/:projectId/inbound/:deviceId',
    getUser,
    isAuthorized,
    async function(req, res) {
        return await _updateDeviceMonitorPingTime(req, res);
    }
);

const _updateDeviceMonitorPingTime = async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const deviceId = req.params.deviceId;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Missing Project ID',
            });
        }

        if (!deviceId) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Missing Device ID',
            });
        }

        const monitor = await MonitorService.updateDeviceMonitorPingTime(
            projectId,
            deviceId
        );
        if (monitor) {
            return sendItemResponse(req, res, monitor);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Monitor not found or is not associated with this project.',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

router.post('/:projectId/addseat', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const seatresponse = await MonitorService.addSeat({
            _id: req.params.projectId,
        });
        return sendItemResponse(req, res, seatresponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { siteUrl } = req.body;
            const monitor = await MonitorService.addSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/siteUrl/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { siteUrl } = req.body;
            const monitor = await MonitorService.removeSiteUrl(
                {
                    _id: req.params.monitorId,
                },
                { siteUrl }
            );
            return sendItemResponse(req, res, monitor);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
