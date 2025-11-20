import { snakeCase } from 'change-case';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { boardColumnFields, boardColumnOperations } from './BoardColumnDescription';
import { boardFields, boardOperations } from './BoardDescription';
import { boardGroupFields, boardGroupOperations } from './BoardGroupDescription';
import { boardItemFields, boardItemOperations } from './BoardItemDescription';
import {
	mondayComApiPaginatedRequest,
	mondayComApiRequest,
	mondayComApiRequestAllItems,
} from './GenericFunctions';

interface IGraphqlBody {
	query: string;
	variables: IDataObject;
}

export const normalizeMondayItem = (item: IDataObject): IDataObject => {
	const mapColumnValues = (cvs: IDataObject[] | undefined) =>
		(cvs || []).map((cv) => {
			const column = (cv.column as IDataObject) || {};
			return {
				id: cv.id,
				value: cv.value,
				text: cv.text,
				display_value: cv.display_value,
				title: column.title,
				additional_info: column.settings_str,
				linked_item_ids: (cv.linked_item_ids as string[]) || undefined,
			} as IDataObject;
		});

	const buildMappables = (cvs: IDataObject[] | undefined) => {
		const out: IDataObject = {};
		for (const cv of cvs || []) {
			const v = cv.value as string | null | undefined;
			const t = cv.text as string | null | undefined;
			const dv = (cv.display_value as string | null | undefined) ?? undefined;
			const linkedIds = (cv.linked_item_ids as string[] | undefined) ?? undefined;
			let mapped: IDataObject | string | null = t ?? dv ?? null;
			if (typeof v === 'string') {
				try {
					const obj = JSON.parse(v);
					const objOut = obj as IDataObject;
					if (t !== undefined && t !== null) objOut.text = t as string;
					if (dv !== undefined && dv !== null) objOut.display_value = dv as string;
					if (linkedIds && Array.isArray(linkedIds)) objOut.linked_item_ids = linkedIds as string[];
					mapped = obj as IDataObject;
				} catch (_e) {
					mapped = t ?? dv ?? v;
				}
			}
			if (!v && linkedIds) {
				mapped = { linked_item_ids: linkedIds, text: t ?? dv ?? null } as IDataObject;
			}
			out[cv.id as string] = mapped as unknown as IDataObject;
		}
		return out;
	};

	const normalizeSubitem = (si: IDataObject) => {
		const cvs = si.column_values as IDataObject[];
		return {
			id: si.id,
			name: si.name,
			created_at: si.created_at,
			updated_at: si.updated_at,
			state: si.state,
			board: si.board,
			creator_id: si.creator_id,
			group: si.group,
			column_values: mapColumnValues(cvs),
			mappable_column_values: buildMappables(cvs),
		} as IDataObject;
	};

	const parent = item.parent_item as IDataObject | undefined;
	const normalizedParent = parent
		? {
				id: parent.id,
				name: parent.name,
				created_at: parent.created_at,
				updated_at: parent.updated_at,
				state: parent.state,
				board: parent.board,
				creator_id: parent.creator_id,
				group: parent.group,
				column_values: mapColumnValues(parent.column_values as IDataObject[]),
			}
		: undefined;

	const subitemsRaw = (item.subitems as IDataObject[]) || [];
	const subitems = subitemsRaw.map((si) => normalizeSubitem(si));

	const itemCvs = mapColumnValues(item.column_values as IDataObject[]);
	const itemMappables = buildMappables(item.column_values as IDataObject[]);

	for (const cv of itemCvs) {
		const infoStr = cv.additional_info as string | undefined;
		if (!infoStr) continue;
		let infoObj: IDataObject | undefined;
		try {
			infoObj = JSON.parse(infoStr) as IDataObject;
		} catch (_e) {
			infoObj = undefined;
		}
		if (!infoObj) continue;
		const relation = (infoObj.relation_column as IDataObject) || {};
		const isSubelements = !!relation.subelementos;
		if (!isSubelements) continue;
		const dlc = infoObj.displayed_linked_columns as IDataObject | undefined;
		if (!dlc) continue;
		const boardIds = Object.keys(dlc);
		if (boardIds.length === 0) continue;
		const targetCols = (dlc[boardIds[0]] as string[]) || [];
		if (targetCols.length === 0) continue;
		const targetCol = targetCols[0];
		const values: string[] = [];
		let sum: number | null = null;
		for (const si of subitems as IDataObject[]) {
			const mm = si.mappable_column_values as IDataObject;
			const val = mm[targetCol];
			let textVal: string | null = null;
			if (val && typeof val === 'object' && (val as IDataObject).text !== undefined) {
				textVal = ((val as IDataObject).text as string) ?? null;
			} else if (typeof val === 'string') {
				textVal = val as string;
			} else if (val === null || val === undefined) {
				textVal = null;
			}
			if (textVal && textVal !== '') values.push(textVal);
			const numeric =
				textVal !== null && textVal !== '' && !isNaN(Number(textVal)) ? Number(textVal) : null;
			if (numeric !== null) sum = (sum ?? 0) + numeric;
		}
		cv.text = values.length > 0 ? values.join(', ') : null;
		cv.value = sum !== null ? JSON.stringify(String(sum)) : cv.value;
	}

	return {
		id: item.id,
		name: item.name,
		email: item.email,
		created_at: item.created_at,
		updated_at: item.updated_at,
		state: item.state,
		board: item.board,
		creator_id: item.creator_id,
		group: item.group,
		column_values: itemCvs,
		mappable_column_values: itemMappables,
		assets: (item.assets as IDataObject[]) || [],
		parent_item: normalizedParent,
		subitems,
	} as IDataObject;
};

export class MondayCom implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Monday.com',
		name: 'mondayCom',
		icon: 'file:mondayCom.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Consume Monday.com API',
		defaults: {
			name: 'Monday.com',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'mondayComApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['accessToken'],
					},
				},
			},
			{
				name: 'mondayComOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['oAuth2'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Access Token',
						value: 'accessToken',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
					},
				],
				default: 'accessToken',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Board',
						value: 'board',
					},
					{
						name: 'Board Column',
						value: 'boardColumn',
					},
					{
						name: 'Board Group',
						value: 'boardGroup',
					},
					{
						name: 'Board Item',
						value: 'boardItem',
					},
				],
				default: 'board',
			},
			//BOARD
			...boardOperations,
			...boardFields,
			// BOARD COLUMN
			...boardColumnOperations,
			...boardColumnFields,
			// BOARD GROUP
			...boardGroupOperations,
			...boardGroupFields,
			// BOARD ITEM
			...boardItemOperations,
			...boardItemFields,
		],
	};

	methods = {
		loadOptions: {
			// Get all the available boards to display them to user so that they can
			// select them easily
			async getBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const body = {
					query: `query ($page: Int, $limit: Int) {
							boards (page: $page, limit: $limit){
								id
								description
								name
							}
						}`,
					variables: {
						page: 1,
					},
				};
				const boards = await mondayComApiRequestAllItems.call(this, 'data.boards', body);
				if (boards === undefined) {
					return returnData;
				}

				for (const board of boards) {
					const boardName = board.name;
					const boardId = board.id;
					const boardDescription = board.description;
					returnData.push({
						name: boardName,
						value: boardId,
						description: boardDescription,
					});
				}
				return returnData;
			},
			// Get all the available columns to display them to user so that they can
			// select them easily
			async getColumns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const boardId = this.getCurrentNodeParameter('boardId') as string;
				const body: IGraphqlBody = {
					query: `query ($boardId: [ID!]) {
							boards (ids: $boardId){
								columns {
									id
									title
								}
							}
						}`,
					variables: {
						boardId,
					},
				};
				const { data } = await mondayComApiRequest.call(this, body);
				if (data === undefined) {
					return returnData;
				}

				const columns = data.boards[0].columns;
				for (const column of columns) {
					const columnName = column.title;
					const columnId = column.id;
					returnData.push({
						name: columnName,
						value: columnId,
					});
				}
				return returnData;
			},
			// Get all the available groups to display them to user so that they can
			// select them easily
			async getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const boardId = this.getCurrentNodeParameter('boardId') as string;
				const body = {
					query: `query ($boardId: ID!) {
							boards ( ids: [$boardId]){
								groups {
									id
									title
								}
							}
						}`,
					variables: {
						boardId,
					},
				};
				const { data } = await mondayComApiRequest.call(this, body);
				if (data === undefined) {
					return returnData;
				}

				const groups = data.boards[0].groups;
				for (const group of groups) {
					const groupName = group.title;
					const groupId = group.id;
					returnData.push({
						name: groupName,
						value: groupId,
					});
				}
				return returnData;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const length = items.length;
		let responseData;
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);
		for (let i = 0; i < length; i++) {
			try {
				if (resource === 'board') {
					if (operation === 'archive') {
						const boardId = this.getNodeParameter('boardId', i);

						const body: IGraphqlBody = {
							query: `mutation ($id: ID!) {
									archive_board (board_id: $id) {
										id
									}
								}`,
							variables: {
								id: boardId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.archive_board;
					}
					if (operation === 'create') {
						const name = this.getNodeParameter('name', i) as string;
						const kind = this.getNodeParameter('kind', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i);

						const body: IGraphqlBody = {
							query: `mutation ($name: String!, $kind: BoardKind!, $templateId: ID) {
									create_board (board_name: $name, board_kind: $kind, template_id: $templateId) {
										id
									}
								}`,
							variables: {
								name,
								kind,
							},
						};

						if (additionalFields.templateId) {
							body.variables.templateId = additionalFields.templateId as number;
						}

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.create_board;
					}
					if (operation === 'get') {
						const boardId = this.getNodeParameter('boardId', i);

						const body: IGraphqlBody = {
							query: `query ($id: [ID!]) {
									boards (ids: $id){
										id
										name
										description
										state
										board_folder_id
										board_kind
										owners {
											id
										}
									}
								}`,
							variables: {
								id: boardId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.boards;
					}
					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i);

						const body: IGraphqlBody = {
							query: `query ($page: Int, $limit: Int) {
									boards (page: $page, limit: $limit){
										id
										name
										description
										state
										board_folder_id
										board_kind
										owners {
											id
										}
									}
								}`,
							variables: {
								page: 1,
							},
						};

						if (returnAll) {
							responseData = await mondayComApiRequestAllItems.call(this, 'data.boards', body);
						} else {
							body.variables.limit = this.getNodeParameter('limit', i);
							responseData = await mondayComApiRequest.call(this, body);
							responseData = responseData.data.boards;
						}
					}
				}
				if (resource === 'boardColumn') {
					if (operation === 'create') {
						const boardId = this.getNodeParameter('boardId', i);
						const title = this.getNodeParameter('title', i) as string;
						const columnType = this.getNodeParameter('columnType', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i);

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON ) {
									create_column (board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) {
										id
									}
								}`,
							variables: {
								boardId,
								title,
								columnType: snakeCase(columnType),
							},
						};

						if (additionalFields.defaults) {
							try {
								JSON.parse(additionalFields.defaults as string);
							} catch (error) {
								throw new NodeOperationError(this.getNode(), 'Defauls must be a valid JSON', {
									itemIndex: i,
								});
							}
							body.variables.defaults = JSON.stringify(
								JSON.parse(additionalFields.defaults as string),
							);
						}

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.create_column;
					}
					if (operation === 'getAll') {
						const boardId = this.getNodeParameter('boardId', i);

						const body: IGraphqlBody = {
							query: `query ($boardId: [ID!]) {
									boards (ids: $boardId){
										columns {
											id
											title
											type
											settings_str
											archived
										}
									}
								}`,
							variables: {
								page: 1,
								boardId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.boards[0].columns;
					}
				}
				if (resource === 'boardGroup') {
					if (operation === 'create') {
						const boardId = this.getNodeParameter('boardId', i);
						const name = this.getNodeParameter('name', i) as string;

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $groupName: String!) {
									create_group (board_id: $boardId, group_name: $groupName) {
										id
									}
								}`,
							variables: {
								boardId,
								groupName: name,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.create_group;
					}
					if (operation === 'delete') {
						const boardId = this.getNodeParameter('boardId', i);
						const groupId = this.getNodeParameter('groupId', i) as string;

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $groupId: String!) {
									delete_group (board_id: $boardId, group_id: $groupId) {
										id
									}
								}`,
							variables: {
								boardId,
								groupId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.delete_group;
					}
					if (operation === 'getAll') {
						const boardId = this.getNodeParameter('boardId', i);

						const body: IGraphqlBody = {
							query: `query ($boardId: [ID!]) {
									boards (ids: $boardId, ){
										id
										groups {
											id
											title
											color
											position
											archived
										}
									}
								}`,
							variables: {
								boardId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.boards[0].groups;
					}
				}
				if (resource === 'boardItem') {
					if (operation === 'addUpdate') {
						const itemId = this.getNodeParameter('itemId', i);
						const value = this.getNodeParameter('value', i) as string;

						const body: IGraphqlBody = {
							query: `mutation ($itemId: ID!, $value: String!) {
									create_update (item_id: $itemId, body: $value) {
										id
									}
								}`,
							variables: {
								itemId,
								value,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.create_update;
					}
					if (operation === 'changeColumnValue') {
						const boardId = this.getNodeParameter('boardId', i);
						const itemId = this.getNodeParameter('itemId', i);
						const columnId = this.getNodeParameter('columnId', i) as string;
						const value = this.getNodeParameter('value', i) as string;

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
									change_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
										id
									}
								}`,
							variables: {
								boardId,
								itemId,
								columnId,
							},
						};

						try {
							JSON.parse(value);
						} catch (error) {
							throw new NodeOperationError(this.getNode(), 'Custom Values must be a valid JSON', {
								itemIndex: i,
							});
						}
						body.variables.value = JSON.stringify(JSON.parse(value));

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.change_column_value;
					}
					if (operation === 'changeMultipleColumnValues') {
						const boardId = this.getNodeParameter('boardId', i);
						const itemId = this.getNodeParameter('itemId', i);
						const columnValues = this.getNodeParameter('columnValues', i) as string;

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
									change_multiple_column_values (board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
										id
									}
								}`,
							variables: {
								boardId,
								itemId,
							},
						};

						try {
							JSON.parse(columnValues);
						} catch (error) {
							throw new NodeOperationError(this.getNode(), 'Custom Values must be a valid JSON', {
								itemIndex: i,
							});
						}
						body.variables.columnValues = JSON.stringify(JSON.parse(columnValues));

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.change_multiple_column_values;
					}
					if (operation === 'create') {
						const boardId = this.getNodeParameter('boardId', i);
						const groupId = this.getNodeParameter('groupId', i) as string;
						const itemName = this.getNodeParameter('name', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i);

						const body: IGraphqlBody = {
							query: `mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON) {
									create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
										id
									}
								}`,
							variables: {
								boardId,
								groupId,
								itemName,
							},
						};

						if (additionalFields.columnValues) {
							try {
								JSON.parse(additionalFields.columnValues as string);
							} catch (error) {
								throw new NodeOperationError(this.getNode(), 'Custom Values must be a valid JSON', {
									itemIndex: i,
								});
							}
							body.variables.columnValues = JSON.stringify(
								JSON.parse(additionalFields.columnValues as string),
							);
						}

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.create_item;
					}
					if (operation === 'delete') {
						const itemId = this.getNodeParameter('itemId', i);

						const body: IGraphqlBody = {
							query: `mutation ($itemId: ID!) {
									delete_item (item_id: $itemId) {
										id
									}
								}`,
							variables: {
								itemId,
							},
						};
						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.delete_item;
					}
					if (operation === 'get') {
						const itemIds = (this.getNodeParameter('itemId', i) as string).split(',');

						const body: IGraphqlBody = {
							query: `query ($itemId: [ID!]){
                                    items (ids: $itemId) {
                                        id
                                        name
                                        email
                                        created_at
                                        updated_at
                                        state
                                        board { id }
                                        creator_id
                                        group { id title deleted archived }
                                        column_values {
                                            id
                                            text
                                            value
                                            column {
                                                title
                                                settings_str
                                            }
                                            ... on BoardRelationValue {
                                                linked_item_ids
                                                display_value
                                            }
                                        }
                                        assets { id name url }
                                        parent_item {
                                            id
                                            name
                                            created_at
                                            updated_at
                                            state
                                            board { id }
                                            creator_id
                                            group { id }
                                            column_values {
                                                id
                                                text
                                                value
                                                column { title settings_str }
                                                ... on BoardRelationValue {
                                                    linked_item_ids
                                                    display_value
                                                }
                                            }
                                        }
                                        subitems {
                                            id
                                            name
                                            created_at
                                            updated_at
                                            state
                                            board { id }
                                            creator_id
                                            group { id }
                                            column_values {
                                                id
                                                text
                                                value
                                                column { title settings_str }
                                                ... on BoardRelationValue {
                                                    linked_item_ids
                                                    display_value
                                                }
                                            }
                                        }
                                    }
                                }`,
							variables: {
								itemId: itemIds,
							},
						};
						responseData = await mondayComApiRequest.call(this, body);
						let itemsData = (responseData.data.items as IDataObject[]).map((item) =>
							normalizeMondayItem(item as IDataObject),
						);
						const allLinkedIds: Set<string> = new Set();
						for (const it of itemsData as IDataObject[]) {
							const cvs = (it.column_values as IDataObject[]) || [];
							for (const cv of cvs) {
								const ids = (cv.linked_item_ids as string[] | undefined) || [];
								for (const id of ids) allLinkedIds.add(String(id));
							}
						}
						let linkedItemsById: Record<string, IDataObject> = {};
						if (allLinkedIds.size > 0) {
							const q: IGraphqlBody = {
								query: `query ($ids: [ID!]){
                                        items(ids: $ids){
                                            id
                                            name
                                            board { id }
                                            column_values { id text value }
                                        }
                                    }`,
								variables: { ids: Array.from(allLinkedIds) },
							};
							const linkedResp = await mondayComApiRequest.call(this, q);
							const linkedItems = (linkedResp.data.items as IDataObject[]) || [];
							linkedItemsById = Object.fromEntries(
								linkedItems.map((li) => [String(li.id), li as IDataObject]),
							);
						}
						itemsData = (itemsData as IDataObject[]).map((it) => {
							const cvs = (it.column_values as IDataObject[]) || [];
							const mappables = (it.mappable_column_values as IDataObject) || {};
							for (const cv of cvs) {
								const infoStr = cv.additional_info as string | undefined;
								if (!infoStr) continue;
								let infoObj: IDataObject | undefined;
								try {
									infoObj = JSON.parse(infoStr) as IDataObject;
								} catch (_e) {
									infoObj = undefined;
								}
								if (!infoObj) continue;
								const linkedIds = ((cv.linked_item_ids as string[]) || []).map((id) => String(id));
								if (
									(cv.text === null || cv.text === undefined || cv.text === '') &&
									linkedIds.length > 0
								) {
									const names = linkedIds
										.map((id) =>
											linkedItemsById[id] ? String(linkedItemsById[id].name ?? '') : '',
										)
										.filter((s) => s && s !== '');
									const display = (cv.display_value as string | undefined) || undefined;
									if (display && display.trim() !== '') cv.text = display;
									else if (names.length > 0) cv.text = names.join(', ');
								}
								const cur = mappables[cv.id as string] as IDataObject | undefined;
								if (cur && typeof cur === 'object') {
									const display = (cv.display_value as string | undefined) || undefined;
									if (display && display.trim() !== '') (cur as IDataObject).text = display;
								}
								const relation = (infoObj.relation_column as IDataObject) || {};
								const isConnectBoards = Object.keys(relation).length > 0;
								if (!isConnectBoards) continue;
								const dlc = infoObj.displayed_linked_columns as IDataObject | undefined;
								if (!dlc) continue;
								const boardIds = Object.keys(dlc);
								if (boardIds.length === 0) continue;
								const targetCols = (dlc[boardIds[0]] as string[]) || [];
								if (targetCols.length === 0) continue;
								const targetCol = targetCols[0];
								const relationIds = Object.keys(relation).filter(
									(k) => (relation as IDataObject)[k] === true,
								);
								let idsToUse = Object.keys(linkedItemsById);
								if (relationIds.length > 0) {
									const specific: string[] = [];
									for (const rid of relationIds) {
										const relCv = cvs.find((c) => c.id === rid);
										const relIds = (relCv?.linked_item_ids as string[] | undefined) || [];
										for (const id of relIds) specific.push(String(id));
									}
									if (specific.length > 0) idsToUse = Array.from(new Set(specific));
								}
								const values: string[] = [];
								let sum: number | null = null;
								for (const id of idsToUse) {
									const li = linkedItemsById[id];
									const b = (li.board as IDataObject) || {};
									if (String(b.id) !== boardIds[0]) continue;
									const lcv = (li.column_values as IDataObject[]) || [];
									const target = lcv.find((c) => c.id === targetCol);
									if (!target) continue;
									let t = (target.text as string | null | undefined) ?? null;
									if (!t) {
										const vRaw = target.value as string | null | undefined;
										if (typeof vRaw === 'string') {
											try {
												const parsed = JSON.parse(vRaw) as IDataObject | string;
												if (typeof parsed === 'string') {
													t = parsed as string;
												} else if (parsed && typeof parsed === 'object') {
													const po = parsed as IDataObject;
													if (typeof po.email === 'string') t = po.email as string;
													else if (typeof po.text === 'string') t = po.text as string;
												}
											} catch (_e) {
												t = vRaw as string;
											}
										}
									}
									if (t && t !== '') values.push(t);
									const numeric = t !== null && t !== '' && !isNaN(Number(t)) ? Number(t) : null;
									if (numeric !== null) sum = (sum ?? 0) + numeric;
								}
								cv.text = values.length > 0 ? values.join(', ') : (cv.text ?? null);
								cv.value = sum !== null ? JSON.stringify(String(sum)) : cv.value;
							}
							return it;
						});
						responseData = itemsData;
					}
					if (operation === 'getAll') {
						const boardId = this.getNodeParameter('boardId', i);
						const groupId = this.getNodeParameter('groupId', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i);

						const fieldsToReturn = `
                        {
                            id
                            name
                            email
                            created_at
                            updated_at
                            state
                            board { id }
                            creator_id
                            group { id title deleted archived }
                            column_values {
                                id
                                text
                                value
                                column { title settings_str }
                                ... on BoardRelationValue {
                                    linked_item_ids
                                    display_value
                                }
                            }
                            assets { id name url }
                            subitems {
                                id
                                name
                                created_at
                                updated_at
                                state
                                board { id }
                                creator_id
                                group { id }
                                column_values {
                                    id
                                    text
                                    value
                                    column { title settings_str }
                                    ... on BoardRelationValue {
                                        linked_item_ids
                                        display_value
                                    }
                                }
                            }
                        }
                        `;

						const body = {
							query: `query ($boardId: [ID!], $groupId: [String], $limit: Int) {
								boards(ids: $boardId) {
									groups(ids: $groupId) {
										id
										items_page(limit: $limit) {
											cursor
											items ${fieldsToReturn}
										}
									}
								}
							}`,
							variables: {
								boardId,
								groupId,
								limit: 100,
							},
						};

						if (returnAll) {
							responseData = await mondayComApiPaginatedRequest.call(
								this,
								'data.boards[0].groups[0].items_page',
								fieldsToReturn,
								body as IDataObject,
							);
						} else {
							body.variables.limit = this.getNodeParameter('limit', i);
							responseData = await mondayComApiRequest.call(this, body);
							responseData = responseData.data.boards[0].groups[0].items_page.items;
						}
						responseData = (responseData as IDataObject[]).map((item) =>
							normalizeMondayItem(item as IDataObject),
						);
						{
							const itemsData = responseData as IDataObject[];
							const allLinkedIds: Set<string> = new Set();
							for (const it of itemsData) {
								const cvs = (it.column_values as IDataObject[]) || [];
								for (const cv of cvs) {
									const ids = (cv.linked_item_ids as string[] | undefined) || [];
									for (const id of ids) allLinkedIds.add(String(id));
									const v = cv.value as string | null | undefined;
									if (typeof v === 'string') {
										try {
											const obj = JSON.parse(v) as IDataObject;
											const lp = (obj.linkedPulseIds as IDataObject[]) || [];
											for (const p of lp) {
												const id = String((p as IDataObject).linkedPulseId);
												if (id) allLinkedIds.add(id);
											}
										} catch {}
									}
								}
							}
							let linkedItemsById: Record<string, IDataObject> = {};
							if (allLinkedIds.size > 0) {
								const q: IGraphqlBody = {
									query: `query ($ids: [ID!]){ items(ids: $ids){ id name board { id } column_values { id text value } } }`,
									variables: { ids: Array.from(allLinkedIds) },
								};
								const linkedResp = await mondayComApiRequest.call(this, q);
								const linkedItems = (linkedResp.data.items as IDataObject[]) || [];
								linkedItemsById = Object.fromEntries(
									linkedItems.map((li) => [String(li.id), li as IDataObject]),
								);
							}
							responseData = itemsData.map((it) => {
								const cvs = (it.column_values as IDataObject[]) || [];
								const mappables = (it.mappable_column_values as IDataObject) || {};
								for (const cv of cvs) {
									const infoStr = cv.additional_info as string | undefined;
									if (!infoStr) continue;
									let infoObj: IDataObject | undefined;
									try {
										infoObj = JSON.parse(infoStr) as IDataObject;
									} catch {
										infoObj = undefined;
									}
									if (!infoObj) continue;
									const linkedIds = ((cv.linked_item_ids as string[]) || []).map((id) =>
										String(id),
									);
									if (
										(cv.text === null || cv.text === undefined || cv.text === '') &&
										linkedIds.length > 0
									) {
										const names = linkedIds
											.map((id) =>
												linkedItemsById[id] ? String(linkedItemsById[id].name ?? '') : '',
											)
											.filter((s) => s && s !== '');
										const display = (cv.display_value as string | undefined) || undefined;
										if (display && display.trim() !== '') cv.text = display;
										else if (names.length > 0) cv.text = names.join(', ');
									}
									const cur = mappables[cv.id as string] as IDataObject | undefined;
									if (cur && typeof cur === 'object') {
										const display = (cv.display_value as string | undefined) || undefined;
										if (display && display.trim() !== '') (cur as IDataObject).text = display;
									}
									const relation = (infoObj.relation_column as IDataObject) || {};
									const isConnectBoards = Object.keys(relation).length > 0;
									if (!isConnectBoards) continue;
									const dlc = infoObj.displayed_linked_columns as IDataObject | undefined;
									if (!dlc) continue;
									const boardIds = Object.keys(dlc);
									if (boardIds.length === 0) continue;
									const targetCols = (dlc[boardIds[0]] as string[]) || [];
									if (targetCols.length === 0) continue;
									const targetCol = targetCols[0];
									const relationIds = Object.keys(relation).filter(
										(k) => (relation as IDataObject)[k] === true,
									);
									let idsToUse = Object.keys(linkedItemsById);
									if (relationIds.length > 0) {
										const specific: string[] = [];
										for (const rid of relationIds) {
											const relCv = cvs.find((c) => c.id === rid);
											const relIdsA = (relCv?.linked_item_ids as string[] | undefined) || [];
											for (const id of relIdsA) specific.push(String(id));
											const vRel = relCv?.value as string | null | undefined;
											if (typeof vRel === 'string') {
												try {
													const obj = JSON.parse(vRel) as IDataObject;
													const lp = (obj.linkedPulseIds as IDataObject[]) || [];
													for (const p of lp) {
														const id = String((p as IDataObject).linkedPulseId);
														if (id) specific.push(id);
													}
												} catch {}
											}
										}
										if (specific.length > 0) idsToUse = Array.from(new Set(specific));
									}
									const values: string[] = [];
									let sum: number | null = null;
									for (const id of idsToUse) {
										const li = linkedItemsById[id];
										if (!li) continue;
										const b = (li.board as IDataObject) || {};
										if (String(b.id) !== boardIds[0]) continue;
										const lcv = (li.column_values as IDataObject[]) || [];
										const target = lcv.find((c) => c.id === targetCol);
										if (!target) continue;
										let t = (target.text as string | null | undefined) ?? null;
										if (!t) {
											const vRaw = target.value as string | null | undefined;
											if (typeof vRaw === 'string') {
												try {
													const parsed = JSON.parse(vRaw) as IDataObject | string;
													if (typeof parsed === 'string') t = parsed as string;
													else if (parsed && typeof parsed === 'object') {
														const po = parsed as IDataObject;
														if (typeof po.email === 'string') t = po.email as string;
														else if (typeof po.text === 'string') t = po.text as string;
													}
												} catch {
													t = vRaw as string;
												}
											}
										}
										if (t && t !== '') values.push(t);
										const numeric = t !== null && t !== '' && !isNaN(Number(t)) ? Number(t) : null;
										if (numeric !== null) sum = (sum ?? 0) + numeric;
									}
									const aggregatedText = values.length > 0 ? values.join(', ') : (cv.text ?? null);
									cv.text = aggregatedText;
									cv.value = sum !== null ? JSON.stringify(String(sum)) : cv.value;
									const curAgg = mappables[cv.id as string] as IDataObject | undefined;
									if (curAgg && typeof curAgg === 'object') {
										(curAgg as IDataObject).text = aggregatedText as string | null;
									}
								}
								return it;
							});
						}
					}
					if (operation === 'getByColumnValue') {
						const boardId = this.getNodeParameter('boardId', i);
						const columnId = this.getNodeParameter('columnId', i) as string;
						const columnValue = this.getNodeParameter('columnValue', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i);

						const fieldsToReturn = `{
                            id
                            name
                            email
                            created_at
                            updated_at
                            state
                            board { id }
                            creator_id
                            group { id title deleted archived }
                            column_values {
                                id
                                text
                                value
                                column { title settings_str }
                                ... on BoardRelationValue {
                                    linked_item_ids
                                    display_value
                                }
                            }
                            assets { id name url }
                            subitems {
                                id
                                name
                                created_at
                                updated_at
                                state
                                board { id }
                                creator_id
                                group { id }
                                column_values {
                                    id
                                    text
                                    value
                                    column { title settings_str }
                                    ... on BoardRelationValue {
                                        linked_item_ids
                                        display_value
                                    }
                                }
                            }
                        }`;
						const body = {
							query: `query ($boardId: ID!, $columnId: String!, $columnValue: String!, $limit: Int) {
								items_page_by_column_values(
									limit: $limit
									board_id: $boardId
									columns: [{column_id: $columnId, column_values: [$columnValue]}]
								) {
									cursor
									items ${fieldsToReturn}
								}
							}`,
							variables: {
								boardId,
								columnId,
								columnValue,
								limit: 100,
							},
						};

						if (returnAll) {
							responseData = await mondayComApiPaginatedRequest.call(
								this,
								'data.items_page_by_column_values',
								fieldsToReturn,
								body as IDataObject,
							);
						} else {
							body.variables.limit = this.getNodeParameter('limit', i);
							responseData = await mondayComApiRequest.call(this, body);
							responseData = responseData.data.items_page_by_column_values.items;
						}
						responseData = (responseData as IDataObject[]).map((item) =>
							normalizeMondayItem(item as IDataObject),
						);
						{
							const itemsData = responseData as IDataObject[];
							const allLinkedIds: Set<string> = new Set();
							for (const it of itemsData) {
								const cvs = (it.column_values as IDataObject[]) || [];
								for (const cv of cvs) {
									const ids = (cv.linked_item_ids as string[] | undefined) || [];
									for (const id of ids) allLinkedIds.add(String(id));
									const v = cv.value as string | null | undefined;
									if (typeof v === 'string') {
										try {
											const obj = JSON.parse(v) as IDataObject;
											const lp = (obj.linkedPulseIds as IDataObject[]) || [];
											for (const p of lp) {
												const id = String((p as IDataObject).linkedPulseId);
												if (id) allLinkedIds.add(id);
											}
										} catch {}
									}
								}
							}
							let linkedItemsById: Record<string, IDataObject> = {};
							if (allLinkedIds.size > 0) {
								const q: IGraphqlBody = {
									query: `query ($ids: [ID!]){ items(ids: $ids){ id name board { id } column_values { id text value } } }`,
									variables: { ids: Array.from(allLinkedIds) },
								};
								const linkedResp = await mondayComApiRequest.call(this, q);
								const linkedItems = (linkedResp.data.items as IDataObject[]) || [];
								linkedItemsById = Object.fromEntries(
									linkedItems.map((li) => [String(li.id), li as IDataObject]),
								);
							}
							responseData = itemsData.map((it) => {
								const cvs = (it.column_values as IDataObject[]) || [];
								const mappables = (it.mappable_column_values as IDataObject) || {};
								for (const cv of cvs) {
									const infoStr = cv.additional_info as string | undefined;
									if (!infoStr) continue;
									let infoObj: IDataObject | undefined;
									try {
										infoObj = JSON.parse(infoStr) as IDataObject;
									} catch {
										infoObj = undefined;
									}
									if (!infoObj) continue;
									const linkedIds = ((cv.linked_item_ids as string[]) || []).map((id) =>
										String(id),
									);
									if (
										(cv.text === null || cv.text === undefined || cv.text === '') &&
										linkedIds.length > 0
									) {
										const names = linkedIds
											.map((id) =>
												linkedItemsById[id] ? String(linkedItemsById[id].name ?? '') : '',
											)
											.filter((s) => s && s !== '');
										const display = (cv.display_value as string | undefined) || undefined;
										if (display && display.trim() !== '') cv.text = display;
										else if (names.length > 0) cv.text = names.join(', ');
									}
									const cur = mappables[cv.id as string] as IDataObject | undefined;
									if (cur && typeof cur === 'object') {
										const display = (cv.display_value as string | undefined) || undefined;
										if (display && display.trim() !== '') (cur as IDataObject).text = display;
									}
									const relation = (infoObj.relation_column as IDataObject) || {};
									const isConnectBoards = Object.keys(relation).length > 0;
									if (!isConnectBoards) continue;
									const dlc = infoObj.displayed_linked_columns as IDataObject | undefined;
									if (!dlc) continue;
									const boardIds = Object.keys(dlc);
									if (boardIds.length === 0) continue;
									const targetCols = (dlc[boardIds[0]] as string[]) || [];
									if (targetCols.length === 0) continue;
									const targetCol = targetCols[0];
									const relationIds = Object.keys(relation).filter(
										(k) => (relation as IDataObject)[k] === true,
									);
									let idsToUse = Object.keys(linkedItemsById);
									if (relationIds.length > 0) {
										const specific: string[] = [];
										for (const rid of relationIds) {
											const relCv = cvs.find((c) => c.id === rid);
											const relIdsA = (relCv?.linked_item_ids as string[] | undefined) || [];
											for (const id of relIdsA) specific.push(String(id));
											const vRel = relCv?.value as string | null | undefined;
											if (typeof vRel === 'string') {
												try {
													const obj = JSON.parse(vRel) as IDataObject;
													const lp = (obj.linkedPulseIds as IDataObject[]) || [];
													for (const p of lp) {
														const id = String((p as IDataObject).linkedPulseId);
														if (id) specific.push(id);
													}
												} catch {}
											}
										}
										if (specific.length > 0) idsToUse = Array.from(new Set(specific));
									}
									const values: string[] = [];
									let sum: number | null = null;
									for (const id of idsToUse) {
										const li = linkedItemsById[id];
										if (!li) continue;
										const b = (li.board as IDataObject) || {};
										if (String(b.id) !== boardIds[0]) continue;
										const lcv = (li.column_values as IDataObject[]) || [];
										const target = lcv.find((c) => c.id === targetCol);
										if (!target) continue;
										let t = (target.text as string | null | undefined) ?? null;
										if (!t) {
											const vRaw = target.value as string | null | undefined;
											if (typeof vRaw === 'string') {
												try {
													const parsed = JSON.parse(vRaw) as IDataObject | string;
													if (typeof parsed === 'string') t = parsed as string;
													else if (parsed && typeof parsed === 'object') {
														const po = parsed as IDataObject;
														if (typeof po.email === 'string') t = po.email as string;
														else if (typeof po.text === 'string') t = po.text as string;
													}
												} catch {
													t = vRaw as string;
												}
											}
										}
										if (t && t !== '') values.push(t);
										const numeric = t !== null && t !== '' && !isNaN(Number(t)) ? Number(t) : null;
										if (numeric !== null) sum = (sum ?? 0) + numeric;
									}
									const aggregatedText = values.length > 0 ? values.join(', ') : (cv.text ?? null);
									cv.text = aggregatedText;
									cv.value = sum !== null ? JSON.stringify(String(sum)) : cv.value;
									const curAgg = mappables[cv.id as string] as IDataObject | undefined;
									if (curAgg && typeof curAgg === 'object') {
										(curAgg as IDataObject).text = aggregatedText as string | null;
									}
								}
								return it;
							});
						}
					}
					if (operation === 'move') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						const itemId = this.getNodeParameter('itemId', i);

						const body: IGraphqlBody = {
							query: `mutation ($groupId: String!, $itemId: ID!) {
									move_item_to_group (group_id: $groupId, item_id: $itemId) {
										id
									}
								}`,
							variables: {
								groupId,
								itemId,
							},
						};

						responseData = await mondayComApiRequest.call(this, body);
						responseData = responseData.data.move_item_to_group;
					}
				}
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject),
					{ itemData: { item: i } },
				);

				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const executionErrorData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({ error: error.message }),
						{ itemData: { item: i } },
					);
					returnData.push(...executionErrorData);
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
