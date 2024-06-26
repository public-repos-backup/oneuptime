import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default interface UpdateBy<TBaseModel extends BaseModel> {
    id: ObjectID;
    data: QueryDeepPartialEntity<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
