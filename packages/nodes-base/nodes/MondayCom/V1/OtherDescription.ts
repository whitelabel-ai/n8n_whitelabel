import type { INodeProperties } from 'n8n-workflow';

export const otherOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['other'],
			},
		},
		options: [
			{
				name: 'Execute a GraphQL Query',
				value: 'executeGraphqlQuery',
				description: 'Performs an arbitrary authorized GraphQL query',
				action: 'Execute a GraphQL Query',
			},
		],
		default: 'executeGraphqlQuery',
	},
];

export const otherFields: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		typeOptions: {
			alwaysOpenEditWindow: true,
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['other'],
				operation: ['executeGraphqlQuery'],
			},
		},
		description: 'GraphQL query or mutation to execute',
	},
	{
		displayName: 'Return Raw',
		name: 'raw',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['other'],
				operation: ['executeGraphqlQuery'],
			},
		},
		description: 'Whether to return full HTTP response instead of GraphQL data field',
	},
];
