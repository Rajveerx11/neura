import { Type } from "typebox";

const text = (maxLength = 500) => Type.String({ minLength: 1, maxLength });
const texts = (minItems: number, maxItems: number, maxLength = 500) => Type.Array(text(maxLength), { minItems, maxItems });
const value = Type.Union([Type.String({ maxLength: 1000 }), Type.Number({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]);
const exerciseBase = { prompt: text(1000), hints: texts(1, 5), explanation: text(2000) };

export const LearnLessonSchema = Type.Object({
  id: Type.String({ minLength: 2, maxLength: 80, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  title: text(160), goal: text(500), steps: texts(1, 5, 120), currentStep: Type.Integer({ minimum: 0, maximum: 4 }),
  bullets: texts(3, 5, 300), example: text(2000),
  diagram: Type.Object({
    kind: Type.Union([Type.Literal("flow"), Type.Literal("er"), Type.Literal("sequence")]),
    title: text(160),
    nodes: Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,39}$" }), label: text(50), detail: Type.Optional(text(240)), fields: Type.Optional(texts(1, 6, 60)) }, { additionalProperties: false }), { minItems: 2, maxItems: 6 }),
    edges: Type.Array(Type.Object({ from: text(40), to: text(40), label: text(80) }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }),
    focus: Type.Optional(text(40)),
  }, { additionalProperties: false }),
  references: Type.Array(Type.Object({
    sourceId: text(80), filename: text(240), unit: Type.Union([Type.Literal("page"), Type.Literal("slide")]),
    number: Type.Integer({ minimum: 1, maximum: 100 }), excerpt: text(2000),
  }, { additionalProperties: false }), { maxItems: 12 }),
  exercise: Type.Union([
    Type.Object({ ...exerciseBase, kind: Type.Literal("choice"), options: texts(2, 6), answer: Type.Integer({ minimum: 0, maximum: 5 }) }, { additionalProperties: false }),
    Type.Object({ ...exerciseBase, kind: Type.Literal("short"), acceptedAnswers: texts(0, 10, 500) }, { additionalProperties: false }),
    Type.Object({
      ...exerciseBase, kind: Type.Literal("sql"), solution: text(4000),
      tables: Type.Array(Type.Object({
        name: text(40),
        columns: Type.Array(Type.Object({ name: text(40), type: Type.Union([Type.Literal("TEXT"), Type.Literal("INTEGER"), Type.Literal("REAL")]) }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }),
        rows: Type.Array(Type.Array(value, { minItems: 1, maxItems: 12 }), { maxItems: 100 }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 6 }),
      expectedRows: Type.Optional(Type.Array(Type.Record(Type.String(), value), { maxItems: 100 })),
    }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
