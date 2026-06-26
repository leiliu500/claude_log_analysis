// Bundles each Lambda handler into its own directory under dist/<name>/index.js.
// We bundle the AWS SDK v3 clients rather than rely on the runtime: the Lambda
// Node 20 runtime only ships a curated subset, and several clients we use
// (bedrock-agent, bedrock-agent-runtime, cloudwatch-logs, secrets-manager) are
// not guaranteed to be present. Bundling makes the deployment self-contained.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const handlersDir = join(__dirname, "src", "handlers");

const handlers = readdirSync(handlersDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""));

await Promise.all(
  handlers.map((name) =>
    build({
      entryPoints: [join(handlersDir, `${name}.ts`)],
      // .mjs so the Lambda Node runtime loads the bundle as an ES module
      // (an ESM bundle named index.js is loaded as CommonJS and fails to parse).
      outfile: join(__dirname, "dist", name, "index.mjs"),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      sourcemap: true,
      minify: true,
      banner: {
        // esm interop shim so `require` works if a transitive dep needs it.
        js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
      },
    }).then(() => console.log(`✓ bundled handler: ${name}`)),
  ),
);

console.log(`\nBuilt ${handlers.length} Lambda bundle(s) into dist/.`);
