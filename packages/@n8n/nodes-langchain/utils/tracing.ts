import type { BaseCallbackConfig } from '@langchain/core/callbacks/manager';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { IExecuteFunctions, ISupplyDataFunctions } from 'n8n-workflow';

interface TracingConfig {
	additionalMetadata?: Record<string, unknown>;
	additionalCallbacks?: BaseCallbackHandler[];
}

export function getTracingConfig(
	context: IExecuteFunctions | ISupplyDataFunctions,
	config: TracingConfig = {},
): BaseCallbackConfig {
	const parentRunManager =
		'getParentCallbackManager' in context && context.getParentCallbackManager
			? context.getParentCallbackManager()
			: undefined;

	const callbacks: any[] = [];
	if (parentRunManager) {
		callbacks.push(parentRunManager);
	}
	if (config.additionalCallbacks) {
		callbacks.push(...config.additionalCallbacks);
	}

	return {
		runName: `[${context.getWorkflow().name}] ${context.getNode().name}`,
		metadata: {
			execution_id: context.getExecutionId(),
			workflow: context.getWorkflow(),
			node: context.getNode().name,
			...(config.additionalMetadata ?? {}),
		},
		callbacks: callbacks.length > 0 ? callbacks : undefined,
	};
}
