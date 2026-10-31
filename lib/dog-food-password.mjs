export function foodPasswordCriteria(password) {
  const value=typeof password==='string'?password:'';
  return {length:value.length>=8,capital:/[A-Z]/.test(value),special:/[^\p{L}\p{N}\s]/u.test(value),bounded:new TextEncoder().encode(value).length<=256};
}
export function foodPasswordValid(password) {
  return typeof password==='string'&&Object.values(foodPasswordCriteria(password)).every(Boolean);
}
