export function withTimeout(
  operation,
  milliseconds,
  message = "The connection took too long. Please try again.",
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
