/** URL base de Blackboard para IE (formulario y reconexión). Sobreescribible con env. */
export function getDefaultBlackboardBaseUrl(): string {
  const env =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_BLACKBOARD_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  return "https://blackboard.ie.edu";
}
