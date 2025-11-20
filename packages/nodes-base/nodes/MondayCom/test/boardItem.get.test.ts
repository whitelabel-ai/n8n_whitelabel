import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';

describe('MondayCom Node - boardItem.get', () => {
	const baseUrl = 'https://api.monday.com';

	beforeAll(() => {
		nock.disableNetConnect();

		nock(baseUrl)
			.post('/v2/')
			.reply(200, {
				data: {
					items: [
						{
							id: '123',
							name: 'Item Name',
							email: 'item@test.com',
							created_at: '2025-01-01T00:00:00Z',
							updated_at: '2025-01-02T00:00:00Z',
							state: 'active',
							board: { id: '999' },
							creator_id: '1',
							group: { id: 'group1', title: 'Group', deleted: false, archived: false },
							column_values: [
								{
									id: 'link',
									text: null,
									value: '{"linkedPulseIds":[{"linkedPulseId":"42"}]}',
									display_value: 'Linked Name',
									linked_item_ids: ['42'],
									column: {
										title: 'Link Col',
										settings_str:
											'{"relation_column":{"link":true},"displayed_linked_columns":{"999":["price"]}}',
									},
								},
							],
							assets: [],
							parent_item: {
								id: 'P1',
								name: 'Parent',
								created_at: '2024-12-31T00:00:00Z',
								updated_at: '2025-01-01T00:00:00Z',
								state: 'active',
								board: { id: '999' },
								creator_id: '1',
								group: { id: 'group1' },
								column_values: [
									{
										id: 'parent_col',
										text: 'Parent Text',
										value: '"val"',
										column: { title: 'Parent Col', settings_str: '{}' },
									},
								],
							},
							subitems: [],
						},
					],
				},
			})
			.post('/v2/')
			.reply(200, {
				data: {
					items: [
						{
							id: '42',
							name: 'Linked Name',
							board: { id: '999' },
							column_values: [{ id: 'price', text: '10', value: '"10"' }],
						},
					],
				},
			});
	});

	new NodeTestHarness().setupTests({
		workflowFiles: ['get.workflow.json'],
		credentials: {
			mondayComOAuth2Api: {
				oauthTokenData: { access_token: 'test-token' },
			},
		},
	});
});
