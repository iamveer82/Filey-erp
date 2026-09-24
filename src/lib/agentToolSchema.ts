/** Filey's JSON-schema boundary, following DeepSeek Harness's validate-before-dispatch pipeline.
 * No coercion: a mistaken amount or record identifier must be corrected by the model. */
interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

export function validateToolArgs(schema: Record<string, unknown>, value: unknown): string | null {
  const queue: { schema: Schema; value: unknown; path: string; depth: number }[] = [{ schema, value, path: "arguments", depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { schema: s, value: v, path, depth } = queue.pop()!;
    if (++visited > 20_000 || depth > 32) return "Arguments are too large or deeply nested.";
    const object = v !== null && typeof v === "object" && !Array.isArray(v);
    const matches = (type: string) => type === "object" ? object : type === "array" ? Array.isArray(v)
      : type === "null" ? v === null : type === "integer" ? Number.isSafeInteger(v)
      : type === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === type;
    if (s.type && !(Array.isArray(s.type) ? s.type : [s.type]).some(matches)) return `${path} must be ${String(s.type)}.`;
    if (s.enum && !s.enum.some(item => JSON.stringify(item) === JSON.stringify(v))) return `${path} must be one of ${JSON.stringify(s.enum)}.`;
    if (typeof v === "number" && (!Number.isFinite(v) || (s.minimum != null && v < s.minimum) || (s.maximum != null && v > s.maximum))) return `${path} is outside the allowed numeric range.`;
    if (typeof v === "string" && ((s.minLength != null && v.length < s.minLength) || (s.maxLength != null && v.length > s.maxLength))) return `${path} has an invalid length.`;
    if (Array.isArray(v)) {
      if ((s.minItems != null && v.length < s.minItems) || (s.maxItems != null && v.length > s.maxItems)) return `${path} has an invalid number of items.`;
      if (v.length > 20_000) return "Arguments contain too many items.";
      v.forEach((item, i) => queue.push({ schema: s.items ?? {}, value: item, path: `${path}[${i}]`, depth: depth + 1 }));
    } else if (object) {
      const record = v as Record<string, unknown>;
      for (const key of s.required ?? []) if (!Object.prototype.hasOwnProperty.call(record, key)) return `${path}.${key} is required.`;
      for (const [key, item] of Object.entries(record)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) return `${path} contains an unsupported property.`;
        const declared = s.properties && Object.prototype.hasOwnProperty.call(s.properties, key) ? s.properties[key] : undefined;
        if (!declared && s.additionalProperties === false) return `${path}.${key} is not supported.`;
        const child = declared ?? (typeof s.additionalProperties === "object" ? s.additionalProperties : {});
        queue.push({ schema: child, value: item, path: `${path}.${key}`, depth: depth + 1 });
      }
    }
  }
  return null;
}
