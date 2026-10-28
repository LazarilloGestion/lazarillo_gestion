// Teléfonos (no tablets: un iPad o un Android sin "Mobile" se quedan con el Panel).
// Lo usa proxy.ts para mandar /dashboard a la versión celular (/m).
export function esCelular(ua: string | null): boolean {
  return !!ua && /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua) && !/iPad|Tablet/i.test(ua);
}
