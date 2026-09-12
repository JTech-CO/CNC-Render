import { compareStockResult, type ResultComparisonInput } from "./result-comparison";
import { validateResultComparisonRequest } from "./result-comparison-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ readonly requestId: number; readonly input: ResultComparisonInput }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;
scope.onmessage = ({ data }) => {
  try {
    const request = validateResultComparisonRequest(data);
    const result = compareStockResult(request.input);
    scope.postMessage({ protocolVersion: 1, requestId: request.requestId, result }, [result.field.actualMm.buffer, result.field.targetMm.buffer,
      result.field.signedDeviationMm.buffer, result.field.coordinatesMm.buffer]);
  } catch (error) {
    scope.postMessage({ protocolVersion: 1, requestId: data?.requestId, error: (error instanceof Error ? error.message : "결과 비교에 실패했습니다.").slice(0, 4096) });
  }
};
