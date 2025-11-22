import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';

describe('MondayCom Node - other.executeGraphqlQuery', () => {
	const baseUrl = 'https://api.monday.com';

	beforeAll(() => {
		nock.disableNetConnect();

		nock(baseUrl)
			.post('/v2/')
			.reply(200, {
				data: {
					me: { id: '123' },
				},
			});
	});

	new NodeTestHarness().setupTests({
		workflowFiles: ['other.execute.workflow.json'],
		credentials: {
			mondayComOAuth2Api: {
				oauthTokenData: { access_token: 'test-token' },
			},
		},
	});
});
