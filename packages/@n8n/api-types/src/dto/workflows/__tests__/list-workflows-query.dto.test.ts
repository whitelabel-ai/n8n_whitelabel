import { ListWorkflowsQueryDto } from '../list-workflows-query.dto';

describe('ListWorkflowsQueryDto', () => {
	test('accepts an empty query and applies defaults', () => {
		const result = ListWorkflowsQueryDto.safeParse({});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.offset).toBe(0);
			expect(result.data.limit).toBe(100);
			expect(result.data.excludePinnedData).toBe(false);
		}
	});

	test('accepts folderId as a string', () => {
		const result = ListWorkflowsQueryDto.safeParse({ folderId: 'X8ovzm8lTQjcXRZQ' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.folderId).toBe('X8ovzm8lTQjcXRZQ');
		}
	});

	test('leaves folderId undefined when omitted', () => {
		const result = ListWorkflowsQueryDto.safeParse({});

		expect(result.success && result.data.folderId).toBeUndefined();
	});

	test('rejects a non-string folderId', () => {
		const result = ListWorkflowsQueryDto.safeParse({ folderId: ['a', 'b'] });

		expect(result.success).toBe(false);
	});
});
