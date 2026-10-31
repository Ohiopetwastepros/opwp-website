import vm from 'node:vm';
import staffPrivate from '../../lib/staff-private.json' with {type:'json'};
export const runPrivateInNewContext=(source,context={},options)=>{const scope=Object.isExtensible(context)?context:{...context};if(!Object.hasOwn(scope,'staffPrivate'))scope.staffPrivate=staffPrivate;return vm.runInNewContext(source,scope,options);};
