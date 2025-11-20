import { normalizeMondayItem } from '../MondayCom.node';
import type { IDataObject } from 'n8n-workflow';

describe('MondayCom normalizeMondayItem', () => {
	it('maps column_values and aggregates subelements', () => {
		const item: IDataObject = {
			id: '1',
			name: 'Parent Item',
			created_at: '2025-01-01T00:00:00Z',
			updated_at: '2025-01-02T00:00:00Z',
			state: 'active',
			board: { id: 'B1' },
			creator_id: 'U1',
			group: { id: 'group1' },
			column_values: [
				{
					id: 'subelementos_total__1',
					text: null,
					value: null,
					column: {
						title: 'Total',
						settings_str:
							'{"relation_column":{"subelementos":true},"displayed_linked_columns":{"B2":["n_meros_1__1"]}}',
					},
				},
			] as unknown as IDataObject[],
			parent_item: undefined,
			subitems: [
				{
					id: 'si1',
					name: 'S1',
					created_at: '2025-01-01T00:00:00Z',
					updated_at: '2025-01-01T00:00:00Z',
					state: 'active',
					board: { id: 'B2' },
					creator_id: 'U2',
					group: { id: 'topics' },
					column_values: [
						{
							id: 'n_meros_1__1',
							text: '5',
							value: '"5"',
							column: { title: 'Total', settings_str: '{}' },
						},
					],
				},
				{
					id: 'si2',
					name: 'S2',
					created_at: '2025-01-01T00:00:00Z',
					updated_at: '2025-01-01T00:00:00Z',
					state: 'active',
					board: { id: 'B2' },
					creator_id: 'U2',
					group: { id: 'topics' },
					column_values: [
						{
							id: 'n_meros_1__1',
							text: '15',
							value: '"15"',
							column: { title: 'Total', settings_str: '{}' },
						},
					],
				},
			] as unknown as IDataObject[],
		};

		const out = normalizeMondayItem(item);

		const cvs = out.column_values as IDataObject[];
		const totalCv = cvs.find((c) => c.id === 'subelementos_total__1') as IDataObject;
		expect(totalCv.text).toBe('5, 15');
		expect(totalCv.value).toBe('"20"');

		const mappables = out.mappable_column_values as IDataObject;
		expect(mappables['subelementos_total__1']).toBeDefined();
	});
});
