/** Detecta Netlify también dentro del runtime Lambda, donde NETLIFY puede faltar. */
export function isNetlifyRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.NETLIFY_CONTEXT) ||
    String(process.env.URL || process.env.DEPLOY_URL || "").includes("netlify.app")
  );
}
