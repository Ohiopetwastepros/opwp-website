import {createFoodSalesService} from './food-sales-ledger.mjs';
import {readFoodOperations} from './dog-food-ops-store';
import {reserveFoodLots,checkFoodLotReconciliation} from './dog-food-fulfillment';

export const foodSalesService=createFoodSalesService({readFoodOperations,reserveFoodLots,checkFoodLotReconciliation});
