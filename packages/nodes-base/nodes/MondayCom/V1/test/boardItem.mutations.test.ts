import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import nock from 'nock';

describe('MondayCom Node - boardItem mutations', () => {
	const baseUrl = 'https://api.monday.com';

	beforeAll(() => {
		nock.disableNetConnect();

		nock(baseUrl)
			.post(
				'/v2/',
				(body: any) =>
					typeof body?.query === 'string' && body.query.includes('change_column_value'),
			)
			.times(1)
			.reply(200, {
				data: { change_column_value: { id: '123' } },
			});

		nock(baseUrl)
			.post(
				'/v2/',
				(body: any) =>
					typeof body?.query === 'string' && body.query.includes('change_multiple_column_values'),
			)
			.times(1)
			.reply(200, {
				data: { change_multiple_column_values: { id: '123' } },
			});

		nock(baseUrl)
			.post(
				'/v2/',
				(body: any) => typeof body?.query === 'string' && body.query.includes('create_item'),
			)
			.times(1)
			.reply(200, {
				data: { create_item: { id: '9999' } },
			});

		nock(baseUrl)
			.post(
				'/v2/',
				(body: any) => typeof body?.query === 'string' && body.query.includes('delete_item'),
			)
			.times(1)
			.reply(200, {
				data: { delete_item: { id: '123' } },
			});

		nock(baseUrl)
			.post(
				'/v2/',
				(body: any) => typeof body?.query === 'string' && body.query.includes('move_item_to_group'),
			)
			.times(1)
			.reply(200, {
				data: { move_item_to_group: { id: '123' } },
			});
	});

	new NodeTestHarness().setupTests({
		workflowFiles: [
			'changeColumnValue.workflow.json',
			'changeMultipleColumnValues.workflow.json',
			'create.workflow.json',
			'delete.workflow.json',
			'move.workflow.json',
		],
		credentials: {
			mondayComOAuth2Api: {
				oauthTokenData: { access_token: 'test-token' },
			},
		},
	});
});
