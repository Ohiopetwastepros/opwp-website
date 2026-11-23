import reactHooks from 'eslint-plugin-react-hooks';
// Noninteractive syntax/correctness gate for application source. Keep legacy
// formatting unchanged; apply undefined-name checks to the new sales boundary.
export default [
  {ignores:['node_modules/**','.next/**','.open-next/**','tmp/**','private/**','output/**','field-demo-runtime/**','shareable/**','public/**']},
  {
    files:['app/**/*.js','components/**/*.js','lib/**/*.{js,mjs}','scripts/*.mjs','middleware.js','next.config.js'],
    plugins:{'react-hooks':reactHooks},
    languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},
    rules:{'no-unreachable':'error','no-unsafe-finally':'error','no-dupe-args':'error','no-dupe-keys':'error','no-duplicate-case':'error','no-sparse-arrays':'error','valid-typeof':'error','no-eval':'error','no-new-func':'error'},
  },
  {
    files:['lib/food-sales-*.{js,mjs}','app/food-sales/**/*.js','app/api/food-sales/**/*.js','app/api/food-sales/route.js','app/api/admin/dog-food/sales-review/route.js','app/api/admin/dog-food/staff-access/route.js','app/admin/dog-food/staff-access/**/*.js','app/admin/dog-food/review/**/*.js'],
    languageOptions:{globals:Object.fromEntries(['window','crypto','TextEncoder','TextDecoder','Response','Request','URL','console','fetch','AbortController','setTimeout','clearTimeout','sessionStorage','localStorage','FormData'].map(name=>[name,'readonly']))},
    rules:{'no-undef':'error','react-hooks/rules-of-hooks':'error'},
  },
];
