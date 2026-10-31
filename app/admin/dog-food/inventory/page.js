import DogFoodWorkspacePage from '../DogFoodWorkspacePage';
export const dynamic='force-dynamic';
export const metadata={title:'Dog Food Inventory & Demand | OPWP',robots:{index:false,follow:false,nocache:true}};
export default function FoodInventoryPage(){return <DogFoodWorkspacePage initialTab="metrics" section="food-inventory" destination="/admin/dog-food/inventory/"/>;}
