import '../../openapi-extend';

import { z } from 'zod';

import { includeParentFolderOpenApi, workflowListQueryFieldDocs } from './workflow-public.openapi';
import { booleanFromString } from '../../schemas/boolean-from-string';
import { Z } from '../../zod-class';
import { publicApiPaginationSchema } from '../pagination/pagination.dto';

export class ListWorkflowsQueryDto extends Z.class({
	...publicApiPaginationSchema,
	cursor: z.string().optional(),
	active: booleanFromString.optional(),
	tags: z.string().optional(),
	name: z.string().optional(),
	projectId: z.string().optional(),
	// Fork addition: filter by folder, including its subfolders.
	folderId: z.string().optional().openapi(workflowListQueryFieldDocs.folderId),
	excludePinnedData: booleanFromString.optional().default('false'),
	includeParentFolder: booleanFromString
		.optional()
		.default('false')
		.openapi(includeParentFolderOpenApi),
}) {}
