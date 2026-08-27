const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const bounded = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, finite(value)));

export function roundPriceUp(value, increment = 5) {
  const safeValue = Math.max(0, finite(value));
  if (safeValue === 0) return 0;
  const safeIncrement = bounded(increment, 1, 100);
  return Math.ceil((safeValue - Number.EPSILON) / safeIncrement) * safeIncrement;
}

export function calculateJobPrice(input = {}) {
  const wages = (Array.isArray(input.technicianWages) ? input.technicianWages : [])
    .slice(0, 3)
    .map((wage) => bounded(wage, 0, 250));
  const jobMinutes = bounded(input.jobMinutes, 0, 24 * 60);
  const additionalMinutes = bounded(input.additionalMinutes, 0, 8 * 60);
  const totalMinutes = jobMinutes + additionalMinutes;
  const paidHoursPerTechnician = totalMinutes / 60;
  const technicianCount = wages.length;
  const laborHours = paidHoursPerTechnician * technicianCount;
  const burdenPercent = bounded(input.burdenPercent, 0, 100);
  const fixedOverheadPerCrewHour = bounded(input.fixedOverheadPerCrewHour, 0, 10000);
  const fixedJobCosts = input.fixedOverheadPerCrewHour === undefined
    ? bounded(input.fixedJobCosts, 0, 10000)
    : fixedOverheadPerCrewHour * paidHoursPerTechnician;
  const targetRevenuePerCrewHour = bounded(input.targetRevenuePerCrewHour, 0, 5000);
  const targetMarginPercent = bounded(input.targetMarginPercent, 0, 95);
  const actualPriceNumber = finite(input.actualPrice, 0);

  const directLabor = wages.reduce((sum, wage) => sum + wage, 0) * paidHoursPerTechnician;
  const burdenedTechnicianIndex = Math.min(Math.max(Math.trunc(finite(input.burdenedTechnicianIndex)), 0), Math.max(wages.length - 1, 0));
  const burdenedLabor = input.burdenedTechnicianIndex === undefined
    ? directLabor
    : (wages[burdenedTechnicianIndex] || 0) * paidHoursPerTechnician;
  const payrollBurdenCost = burdenedLabor * burdenPercent / 100;
  const loadedLabor = directLabor + payrollBurdenCost;
  const estimatedCost = loadedLabor + fixedJobCosts;
  const hourlyFloor = targetRevenuePerCrewHour * paidHoursPerTechnician;
  const marginFloor = estimatedCost / (1 - targetMarginPercent / 100);
  const recommendedExact = totalMinutes > 0 ? Math.max(hourlyFloor, marginFloor) : 0;
  const recommendedPrice = roundPriceUp(recommendedExact, input.roundingIncrement);
  const hasActualPrice = actualPriceNumber > 0;
  const priceUsed = hasActualPrice ? bounded(actualPriceNumber, 0, 100000) : recommendedPrice;
  const contributionDollars = priceUsed - estimatedCost;
  const contributionMarginPercent = priceUsed > 0 ? (contributionDollars / priceUsed) * 100 : 0;
  const crewRevenuePerHour = paidHoursPerTechnician > 0 ? priceUsed / paidHoursPerTechnician : 0;
  const laborRevenuePerHour = laborHours > 0 ? priceUsed / laborHours : 0;
  const meetsHourlyTarget = crewRevenuePerHour + 0.005 >= targetRevenuePerCrewHour;
  const meetsMarginTarget = contributionMarginPercent + 0.005 >= targetMarginPercent;

  let status = "empty";
  if (totalMinutes > 0 && wages.some((wage) => wage <= 0)) status = "missing_wage";
  else if (totalMinutes > 0 && contributionDollars < 0) status = "loss";
  else if (totalMinutes > 0 && meetsHourlyTarget && meetsMarginTarget) status = "on_target";
  else if (totalMinutes > 0 && (crewRevenuePerHour >= targetRevenuePerCrewHour * 0.9 || contributionMarginPercent >= targetMarginPercent * 0.9)) status = "near_target";
  else if (totalMinutes > 0) status = "below_target";

  return {
    technicianCount,
    jobMinutes,
    additionalMinutes,
    totalMinutes,
    paidHoursPerTechnician,
    laborHours,
    directLabor,
    payrollBurdenCost,
    loadedLabor,
    fixedOverheadPerCrewHour,
    fixedJobCosts,
    estimatedCost,
    hourlyFloor,
    marginFloor,
    recommendedExact,
    recommendedPrice,
    priceUsed,
    hasActualPrice,
    contributionDollars,
    contributionMarginPercent,
    crewRevenuePerHour,
    laborRevenuePerHour,
    meetsHourlyTarget,
    meetsMarginTarget,
    status,
  };
}
