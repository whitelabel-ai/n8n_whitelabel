import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { Serialized } from '@langchain/core/load/serializable';
import type { IExecuteFunctions, ISupplyDataFunctions } from 'n8n-workflow';

export interface TrackingPayload {
	performance: {
		latencyMs: number;
		queueTimeMs: number;
	};
	context: {
		executionId: string;
		workflowId: string;
		workflowName: string;
		nodeName: string;
		input_variables?: Record<string, unknown>;
	};
	metadata: {
		n8nVersion: string;
		instanceId: string;
	};
	llm?: {
		provider?: string;
		model?: string;
	};
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
	raw?: {
		llmOutput: unknown;
		generationInfo: unknown;
	};
}

type ModelInfo = {
	provider?: string;
	model?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getRecordValue(record: Record<string, unknown> | undefined, key: string): unknown {
	if (!record) return undefined;
	return record[key];
}

function getStringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumberValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getFirstString(
	record: Record<string, unknown> | undefined,
	keys: string[],
): string | undefined {
	if (!record) return undefined;
	for (const key of keys) {
		const value = getStringValue(record[key]);
		if (value) return value;
	}
	return undefined;
}

function extractModelInfoFromSerialized(llm?: Serialized): ModelInfo {
	if (!llm || !isRecord(llm)) {
		return {};
	}

	const modelInfo: ModelInfo = {};

	if ('id' in llm && Array.isArray(llm.id)) {
		const providerCandidate = llm.id[llm.id.length - 1];
		const provider = getStringValue(providerCandidate);
		if (provider) {
			modelInfo.provider = provider;
		}
	}

	const llmRecord = llm as Record<string, unknown>;
	const kwargs =
		llmRecord.type === 'constructor' && isRecord(llmRecord.kwargs)
			? (llmRecord.kwargs as Record<string, unknown>)
			: llmRecord;

	const model = getFirstString(kwargs, [
		'model',
		'modelName',
		'modelId',
		'model_id',
		'deploymentName',
	]);
	const provider = getFirstString(kwargs, ['provider']);

	if (model) modelInfo.model = model;
	if (provider && !modelInfo.provider) modelInfo.provider = provider;

	return modelInfo;
}

function extractModelInfoFromOutput(output: LLMResult): ModelInfo {
	const modelInfo: ModelInfo = {};
	const firstGeneration = output.generations.flat()[0];

	const message = isRecord(firstGeneration)
		? getRecordValue(firstGeneration, 'message')
		: undefined;
	const responseMetadata = isRecord(message)
		? getRecordValue(message as Record<string, unknown>, 'response_metadata')
		: undefined;

	if (isRecord(responseMetadata)) {
		modelInfo.provider =
			getStringValue(responseMetadata.provider) ?? getStringValue(responseMetadata.provider_name);
		modelInfo.model =
			getStringValue(responseMetadata.model) ??
			getStringValue(responseMetadata.model_name) ??
			getStringValue(responseMetadata.modelName);
	}

	const generationInfo = isRecord(firstGeneration)
		? getRecordValue(firstGeneration, 'generationInfo')
		: undefined;
	if (isRecord(generationInfo)) {
		if (!modelInfo.provider) {
			modelInfo.provider =
				getStringValue(generationInfo.provider) ?? getStringValue(generationInfo.provider_name);
		}
		if (!modelInfo.model) {
			modelInfo.model =
				getStringValue(generationInfo.model) ??
				getStringValue(generationInfo.model_name) ??
				getStringValue(generationInfo.modelName);
		}
	}

	const llmOutput = output.llmOutput;
	if (isRecord(llmOutput)) {
		if (!modelInfo.model) {
			modelInfo.model =
				getStringValue(llmOutput.model) ??
				getStringValue(llmOutput.model_name) ??
				getStringValue(llmOutput.modelName);
		}
		if (!modelInfo.provider) {
			modelInfo.provider =
				getStringValue(llmOutput.provider) ?? getStringValue(llmOutput.provider_name);
		}
	}

	return modelInfo;
}

export class TrackingCallbackHandler extends BaseCallbackHandler {
	name = 'TrackingCallbackHandler';
	context: IExecuteFunctions | ISupplyDataFunctions;
	webhookUrl: string;
	startTime: number = 0;
	itemIndex: number;
	modelInfo: ModelInfo = {};

	constructor(
		context: IExecuteFunctions | ISupplyDataFunctions,
		webhookUrl: string,
		itemIndex: number = 0,
	) {
		super();
		this.context = context;
		this.webhookUrl = webhookUrl;
		this.itemIndex = itemIndex;
	}

	override async handleLLMStart(
		llm?: Serialized,
		_prompts?: string[],
		_runId?: string,
		_parentRunId?: string,
		_extraParams?: Record<string, unknown>,
	) {
		this.startTime = Date.now();
		this.modelInfo = extractModelInfoFromSerialized(llm);
	}

	override async handleLLMEnd(output: LLMResult) {
		const latencyMs = Date.now() - this.startTime;

		const llmOutput = output.llmOutput ?? {};
		const firstGeneration = output.generations.flat()[0];
		const generationInfo = isRecord(firstGeneration)
			? (getRecordValue(firstGeneration, 'generationInfo') ?? {})
			: {};
		const outputModelInfo = extractModelInfoFromOutput(output);
		const resolvedModelInfo: ModelInfo = {
			provider: outputModelInfo.provider ?? this.modelInfo.provider,
			model: outputModelInfo.model ?? this.modelInfo.model,
		};

		let inputTokens = 0;
		let outputTokens = 0;
		let totalTokens = 0;

		// 1. Standard LangChain tokenUsage
		const tokenUsage = isRecord(llmOutput)
			? (getRecordValue(llmOutput, 'tokenUsage') as Record<string, unknown> | undefined)
			: undefined;
		if (tokenUsage) {
			const promptTokens =
				getNumberValue(tokenUsage.promptTokens) ?? getNumberValue(tokenUsage.inputTokens);
			const completionTokens =
				getNumberValue(tokenUsage.completionTokens) ?? getNumberValue(tokenUsage.outputTokens);
			if (promptTokens !== undefined || completionTokens !== undefined) {
				inputTokens = promptTokens ?? 0;
				outputTokens = completionTokens ?? 0;
				totalTokens =
					getNumberValue(tokenUsage.totalTokens) ??
					getNumberValue(tokenUsage.total_tokens) ??
					inputTokens + outputTokens;
			}
		}
		// 2. Anthropic
		else if (isRecord(llmOutput) && isRecord(llmOutput.usage)) {
			const usage = llmOutput.usage;
			inputTokens = getNumberValue(usage.input_tokens) ?? 0;
			outputTokens = getNumberValue(usage.output_tokens) ?? 0;
			totalTokens = getNumberValue(usage.total_tokens) ?? inputTokens + outputTokens;
		}
		// 3. Google Vertex AI / Gemini
		else if (isRecord(generationInfo) && isRecord(generationInfo.usageMetadata)) {
			const usageMetadata = generationInfo.usageMetadata;
			inputTokens = getNumberValue(usageMetadata.promptTokenCount) ?? 0;
			outputTokens = getNumberValue(usageMetadata.candidatesTokenCount) ?? 0;
			totalTokens = getNumberValue(usageMetadata.totalTokenCount) ?? 0;
		}
		// 4. OpenAI estimatedTokenUsage
		else if (isRecord(llmOutput) && isRecord(llmOutput.estimatedTokenUsage)) {
			const estimated = llmOutput.estimatedTokenUsage;
			inputTokens = getNumberValue(estimated.promptTokens) ?? 0;
			outputTokens = getNumberValue(estimated.completionTokens) ?? 0;
			totalTokens = getNumberValue(estimated.totalTokens) ?? inputTokens + outputTokens;
		}

		let inputVariables: Record<string, unknown> | undefined;
		try {
			if ('getInputData' in this.context) {
				const inputData = this.context.getInputData();
				if (inputData?.[this.itemIndex]) {
					inputVariables = inputData[this.itemIndex].json as Record<string, unknown>;
				}
			}
		} catch {
			// Ignore
		}

		const payload: TrackingPayload = {
			performance: {
				latencyMs,
				queueTimeMs: 0,
			},
			context: {
				executionId: this.context.getExecutionId(),
				workflowId: this.context.getWorkflow().id ?? 'unknown',
				workflowName: this.context.getWorkflow().name ?? 'unknown',
				nodeName: this.context.getNode().name,
				input_variables: inputVariables,
			},
			metadata: {
				n8nVersion: process.env.N8N_VERSION || process.env.npm_package_version || 'unknown',
				instanceId:
					(this.context as { getInstanceId?: () => string }).getInstanceId?.() ?? 'unknown',
			},
			...(resolvedModelInfo.model || resolvedModelInfo.provider ? { llm: resolvedModelInfo } : {}),
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				total_tokens: totalTokens,
			},
			raw: {
				llmOutput,
				generationInfo,
			},
		};

		fetch(this.webhookUrl, {
			method: 'POST',
			body: JSON.stringify(payload),
			headers: { 'Content-Type': 'application/json' },
		}).catch((err) => {
			if (process.env.N8N_AI_TRACKING_DEBUG === 'true') {
				console.error('Failed to send tracking payload', err);
			}
		});
	}
}
