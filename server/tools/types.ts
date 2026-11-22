import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** ハヤトが使う自前ツール（サーバー側で実行するもの）。 */
export interface HayatoTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  /** 画面に出す「〜中」の表示 */
  label: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}

export function defineTool<S extends z.ZodObject>(tool: HayatoTool<S>): HayatoTool {
  return tool as unknown as HayatoTool;
}

/** Claude API に渡すツール定義へ変換する。 */
export function toApiTool(tool: HayatoTool): Anthropic.Beta.BetaTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    // ストリーミングでツール入力を逐次受け取る。入力は実行前に zod で検証する。
    eager_input_streaming: true,
  };
}
