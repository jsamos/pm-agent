/**
 * List Bedrock models from src/config/bedrock.json (human-readable map).
 *
 * Usage: npm run bedrock:models
 */

import "dotenv/config";
import { formatBedrockModelList, loadBedrockConfig } from "../lib/bedrock-models.js";

console.log(formatBedrockModelList(loadBedrockConfig()));
