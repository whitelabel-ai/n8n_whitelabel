import { RetrievedWorkflowPublicDto, WorkflowListPublicDto } from '../workflow-public.dto';

// Fork additions on top of the upstream public workflow DTOs:
// `parentFolderId` alias and `shared[].project` on list items.
const share = {
	role: 'workflow:owner',
	workflowId: '1',
	projectId: 'project-1',
	project: {
		id: 'project-1',
		name: 'My project',
		type: 'personal',
		icon: null,
		description: null,
		customTelemetryTags: [],
		creatorId: 'user-1',
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
	},
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z',
};

const baseListItem = {
	id: '1',
	name: 'My workflow',
	active: false,
	activeVersionId: null,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z',
	isArchived: false,
	versionId: 'version-1',
	triggerCount: 0,
	nodes: [],
	connections: {},
	nodeGroups: [],
	settings: null,
	staticData: null,
	meta: null,
	parentFolderId: 'folder-1',
	shared: [share],
	activeVersion: null,
};

const listWith = (item: Record<string, unknown>) =>
	WorkflowListPublicDto.safeParse({ data: [item], nextCursor: null });

describe('WorkflowListPublicDto (fork additions)', () => {
	test('accepts a string or null parentFolderId', () => {
		expect(listWith(baseListItem).success).toBe(true);
		expect(listWith({ ...baseListItem, parentFolderId: null }).success).toBe(true);
	});

	test('requires parentFolderId', () => {
		const { parentFolderId: _omitted, ...withoutAlias } = baseListItem;

		expect(listWith(withoutAlias).success).toBe(false);
	});

	test('requires the project on every shared entry', () => {
		const { project: _omitted, ...shareWithoutProject } = share;

		expect(listWith({ ...baseListItem, shared: [shareWithoutProject] }).success).toBe(false);
	});
});

describe('RetrievedWorkflowPublicDto (fork additions)', () => {
	const { parentFolderId: _alias, ...listOnly } = baseListItem;
	const retrieved = {
		...listOnly,
		description: null,
		versionCounter: 1,
		sourceWorkflowId: null,
		parentFolderId: null,
		parentFolder: null,
	};

	test('accepts parentFolderId alongside parentFolder', () => {
		expect(RetrievedWorkflowPublicDto.safeParse(retrieved).success).toBe(true);
	});

	test('requires parentFolderId', () => {
		const { parentFolderId: _omitted, ...withoutAlias } = retrieved;

		expect(RetrievedWorkflowPublicDto.safeParse(withoutAlias).success).toBe(false);
	});
});
