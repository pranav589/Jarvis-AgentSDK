import { z } from "zod";

/**
 * Converts a Zod schema into a JSON Schema compatible with OpenAI, Claude, and Gemini tools/structured outputs.
 */
export function zodToJsonSchema(schema: any): any {
  if (!schema) return { type: "object", properties: {} };
  
  const typeName = schema._def?.typeName;
  
  switch (typeName) {
    case "ZodObject": {
      const shape = schema.shape;
      const properties: any = {};
      const required: string[] = [];
      
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        
        // Check if optional
        let isOptional = false;
        let currentSchema = value as any;
        while (currentSchema && currentSchema._def) {
          if (currentSchema._def.typeName === "ZodOptional" || currentSchema._def.typeName === "ZodNullable") {
            isOptional = true;
            break;
          }
          currentSchema = currentSchema._def.innerType;
        }
        
        if (!isOptional) {
          required.push(key);
        }
      }
      
      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false
      };
    }
    
    case "ZodString":
      return { type: "string" };
      
    case "ZodNumber":
      return { type: "number" };
      
    case "ZodBoolean":
      return { type: "boolean" };
      
    case "ZodOptional":
    case "ZodNullable":
      return zodToJsonSchema(schema._def.innerType);
      
    case "ZodArray":
      return {
        type: "array",
        items: zodToJsonSchema(schema._def.type)
      };
      
    case "ZodEnum":
      return {
        type: "string",
        enum: schema._def.values
      };
      
    case "ZodEffects": // For refinements/transforms
      return zodToJsonSchema(schema._def.schema);
      
    default:
      return { type: "string" }; // Generic fallback
  }
}
