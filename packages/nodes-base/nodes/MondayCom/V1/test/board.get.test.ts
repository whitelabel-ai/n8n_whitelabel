import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';

describe('MondayCom Node - board.get with workspace and columns', () => {
	const baseUrl = 'https://api.monday.com';

	beforeAll(() => {
		nock.disableNetConnect();

		nock(baseUrl)
			.post('/v2/')
			.reply(200, {
				data: {
					boards: [
						{
							id: '6535601267',
							name: '🔵 San Roman 🐕🐩',
							description: null,
							state: 'active',
							board_folder_id: '13999223',
							board_kind: 'share',
							owners: [{ id: '58193585' }],
							workspace: { id: '12345', name: 'Veterinaria' },
							columns: [
								{ id: 'name', type: 'name', title: 'Name', settings_str: '{}' },
								{ id: 'subelementos', type: 'subtasks', title: 'Subelementos', settings_str: '{}' },
							],
						},
					],
				},
			});
	});

	new NodeTestHarness().setupTests({
		workflowFiles: ['board.get.workflow.json'],
		credentials: {
			mondayComOAuth2Api: {
				oauthTokenData: { access_token: 'test-token' },
			},
		},
	});
});
