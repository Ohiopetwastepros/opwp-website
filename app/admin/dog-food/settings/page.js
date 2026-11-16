import DogFoodWorkspacePage from '../DogFoodWorkspacePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dog Food Plans & Settings | OPWP', robots: { index: false, follow: false } };

export default function FoodSettingsPage() {
  return <DogFoodWorkspacePage initialTab="plans" section="food-settings" destination="/admin/dog-food/settings/" />;
}
