import type {
	GetWorkflowQueryDto,
	ListWorkflowsQueryDto,
	UpdateWorkflowPublicDto,
	UpdateWorkflowQueryDto,
} from '@n8n/api-types';
import type {
	AuthenticatedRequest,
	Folder,
	Project,
	SharedWorkflow,
	WorkflowEntity,
} from '@n8n/db';
import type { GlobalConfig } from '@n8n/config';
import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import { BadRequestError } from '@n8n/errors';
import { PolicyViolationError } from '@/policy/policy-violation.error';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowService } from '@/workflows/workflow.service';

import { WorkflowsPublicController } from '../workflows.public.controller';

describe('WorkflowsPublicController', () => {
	let controller: WorkflowsPublicController;
	const workflowService = mock<WorkflowService>();
	const workflowFinderService = mock<WorkflowFinderService>();
	const globalConfig = { tags: { disabled: true } } as GlobalConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		controller = new WorkflowsPublicController(
			mock(), // workflowHistoryService
			workflowFinderService,
			mock(), // workflowCreationService
			workflowService,
			mock(), // enterpriseWorkflowService
			mock(), // eventService
			globalConfig,
			mock(), // tagService
			mock(), // redactionEnforcementService
		);
	});

	const updateWorkflow = async () =>
		await controller.updateWorkflow(
			mock<AuthenticatedRequest>(),
			mock<Response>(),
			'workflow-id',
			mock<UpdateWorkflowPublicDto>(),
			mock<UpdateWorkflowQueryDto>(),
		);

	describe('updateWorkflow error mapping', () => {
		// The legacy handler answered 400 with the message for anything it did not recognise.
		// Integration tests cover the errors the service raises on purpose; these two cover what
		// happens when it raises something else.
		it('answers 400 for an unexpected error', async () => {
			workflowService.update.mockRejectedValue(new Error('the database went away'));

			await expect(updateWorkflow()).rejects.toThrow(BadRequestError);
			await expect(updateWorkflow()).rejects.toThrow('the database went away');
		});

		it('rethrows a value that is not an Error', async () => {
			workflowService.update.mockRejectedValue('not an error object');

			await expect(updateWorkflow()).rejects.toBe('not an error object');
		});

		it('rethrows a policy violation with its status and violations intact', async () => {
			const violation = {
				kind: 'node-type-unavailable',
				checkId: 'node-allowlist',
				message: 'Slack is not allowed',
			};
			workflowService.update.mockRejectedValue(new PolicyViolationError([violation]));

			const error = await updateWorkflow().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(PolicyViolationError);
			expect((error as PolicyViolationError).httpStatusCode).toBe(403);
			expect((error as PolicyViolationError).meta.violations).toEqual([violation]);
		});
	});

	const date = new Date('2024-01-01T00:00:00.000Z');

	const buildProject = (): Project =>
		({
			id: 'project-1',
			name: 'Project One',
			type: 'team',
			icon: null,
			description: null,
			customTelemetryTags: [],
			creatorId: null,
			createdAt: date,
			updatedAt: date,
		}) as unknown as Project;

	const buildFolder = (overrides: Partial<Folder> = {}): Folder =>
		({
			id: 'folder-1',
			name: 'Folder One',
			parentFolderId: null,
			createdAt: date,
			updatedAt: date,
			...overrides,
		}) as Folder;

	const buildWorkflow = (overrides: Partial<WorkflowEntity> = {}): WorkflowEntity =>
		({
			id: 'workflow-1',
			name: 'Workflow One',
			description: null,
			active: false,
			activeVersionId: null,
			activeVersion: null,
			createdAt: date,
			updatedAt: date,
			isArchived: false,
			versionId: 'version-1',
			versionCounter: 1,
			sourceWorkflowId: null,
			triggerCount: 0,
			nodes: [],
			connections: {},
			nodeGroups: [],
			settings: {},
			staticData: null,
			meta: null,
			pinData: {},
			parentFolder: null,
			shared: [
				{
					role: 'workflow:owner',
					workflowId: 'workflow-1',
					projectId: 'project-1',
					project: buildProject(),
					createdAt: date,
					updatedAt: date,
				} as SharedWorkflow,
			],
			...overrides,
		}) as WorkflowEntity;

	const listQuery = (overrides: Partial<ListWorkflowsQueryDto> = {}) =>
		({ offset: 0, limit: 100, excludePinnedData: false, ...overrides }) as ListWorkflowsQueryDto;

	describe('getWorkflows', () => {
		const list = async (query: ListWorkflowsQueryDto) =>
			await controller.getWorkflows(mock<AuthenticatedRequest>(), mock<Response>(), query);

		it('returns parentFolderId and the project of each share', async () => {
			workflowFinderService.findWorkflowsForUser.mockResolvedValue({
				workflows: [
					buildWorkflow({ id: 'in-folder', parentFolder: buildFolder() }),
					buildWorkflow({ id: 'at-root', parentFolder: null }),
				],
				count: 2,
			});

			const { data } = await list(listQuery());

			expect(data.map((item) => item.parentFolderId)).toEqual(['folder-1', null]);
			expect(data[0].shared[0].project.name).toBe('Project One');
			expect(data[0].shared[0].project.id).toBe('project-1');
		});

		it('asks the finder for projects and the parent folder', async () => {
			workflowFinderService.findWorkflowsForUser.mockResolvedValue({ workflows: [], count: 0 });

			await list(listQuery());

			expect(workflowFinderService.findWorkflowsForUser).toHaveBeenCalledWith(
				expect.anything(),
				['workflow:read'],
				expect.objectContaining({ includeProjects: true, includeParentFolder: true }),
			);
		});

		it('forwards folderId and projectId filters to the finder', async () => {
			workflowFinderService.findWorkflowsForUser.mockResolvedValue({ workflows: [], count: 0 });

			await list(listQuery({ folderId: 'folder-1', projectId: 'project-1' }));

			expect(workflowFinderService.findWorkflowsForUser).toHaveBeenCalledWith(
				expect.anything(),
				['workflow:read'],
				expect.objectContaining({
					filters: expect.objectContaining({ folderId: 'folder-1', projectId: 'project-1' }),
				}),
			);
		});
	});

	describe('getWorkflow', () => {
		const get = async () =>
			await controller.getWorkflow(mock<AuthenticatedRequest>(), mock<Response>(), 'workflow-1', {
				excludePinnedData: false,
			} as GetWorkflowQueryDto);

		it('returns parentFolderId and parentFolder', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue(
				buildWorkflow({ parentFolder: buildFolder({ parentFolderId: 'folder-0' }) }),
			);

			const result = await get();

			expect(workflowFinderService.findWorkflowForUser).toHaveBeenCalledWith(
				'workflow-1',
				expect.anything(),
				['workflow:read'],
				expect.objectContaining({ includeParentFolder: true }),
			);
			expect(result.parentFolderId).toBe('folder-1');
			expect(result.parentFolder).toEqual({
				id: 'folder-1',
				name: 'Folder One',
				parentFolderId: 'folder-0',
				createdAt: date.toISOString(),
				updatedAt: date.toISOString(),
			});
		});

		it('returns null for both fields at the project root', async () => {
			workflowFinderService.findWorkflowForUser.mockResolvedValue(
				buildWorkflow({ parentFolder: null }),
			);

			const result = await get();

			expect(result.parentFolderId).toBeNull();
			expect(result.parentFolder).toBeNull();
		});
	});
});
