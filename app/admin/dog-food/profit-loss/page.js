import DogFoodWorkspacePage from '../DogFoodWorkspacePage';
export const dynamic='force-dynamic';
export const metadata={title:'Dog Food Sales & Profit/Loss | OPWP',robots:{index:false,follow:false,nocache:true}};
export default function FoodProfitLossPage(){return <DogFoodWorkspacePage initialTab="profit" section="food-profit" destination="/admin/dog-food/profit-loss/"/>;}
