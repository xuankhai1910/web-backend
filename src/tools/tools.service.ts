import { BadRequestException, Injectable } from '@nestjs/common';
import { SalaryCalculatorDto, SalaryRegion } from './dto/salary-calculator.dto';

/**
 * Vietnamese personal-income-tax calculator (2024 rules).
 *
 * - Mandatory employee insurance: BHXH 8% + BHYT 1.5% + BHTN 1% = 10.5%
 * - BHXH/BHYT capped at 20× minimum-wage (region-based)
 * - BHTN capped at 20× regional minimum wage
 * - Personal deduction: 11,000,000 / month
 * - Dependent deduction: 4,400,000 / month / dependent
 * - 7-bracket progressive tax
 */
@Injectable()
export class ToolsService {
  // Region-based minimum monthly wage (VND, 2024)
  private readonly REGIONAL_MIN_WAGE: Record<SalaryRegion, number> = {
    1: 4_960_000,
    2: 4_410_000,
    3: 3_860_000,
    4: 3_450_000,
  };
  // Cap for BHXH/BHYT contributions: 20× base salary (general minimum wage)
  private readonly BASE_SALARY_CAP_BHXH = 20 * 2_340_000; // 46,800,000

  private readonly PERSONAL_DEDUCTION = 11_000_000;
  private readonly DEPENDENT_DEDUCTION = 4_400_000;

  // Progressive tax brackets (taxable income tier upper bound, rate)
  private readonly TAX_BRACKETS: Array<{
    upTo: number;
    rate: number;
    sub: number;
  }> = [
    { upTo: 5_000_000, rate: 0.05, sub: 0 },
    { upTo: 10_000_000, rate: 0.1, sub: 250_000 },
    { upTo: 18_000_000, rate: 0.15, sub: 750_000 },
    { upTo: 32_000_000, rate: 0.2, sub: 1_650_000 },
    { upTo: 52_000_000, rate: 0.25, sub: 3_250_000 },
    { upTo: 80_000_000, rate: 0.3, sub: 5_850_000 },
    { upTo: Infinity, rate: 0.35, sub: 9_850_000 },
  ];

  calculate(dto: SalaryCalculatorDto) {
    const region: SalaryRegion = (dto.region ?? 1) as SalaryRegion;
    const dependents = dto.dependents ?? 0;

    if (
      (dto.grossSalary === undefined || dto.grossSalary === null) &&
      (dto.netSalary === undefined || dto.netSalary === null)
    ) {
      throw new BadRequestException('Phải cung cấp grossSalary hoặc netSalary');
    }

    let gross: number;
    if (dto.grossSalary !== undefined && dto.grossSalary !== null) {
      gross = dto.grossSalary;
    } else {
      gross = this.netToGross(
        dto.netSalary as number,
        dependents,
        region,
        dto.insuranceSalary,
      );
    }

    return this.computeFromGross(
      gross,
      dependents,
      region,
      dto.insuranceSalary,
    );
  }

  private computeInsurance(
    insuranceBase: number,
    region: SalaryRegion,
  ): {
    socialInsurance: number;
    healthInsurance: number;
    unemploymentInsurance: number;
    totalInsurance: number;
  } {
    const bhxhBase = Math.min(insuranceBase, this.BASE_SALARY_CAP_BHXH);
    const bhtnCap = 20 * this.REGIONAL_MIN_WAGE[region];
    const bhtnBase = Math.min(insuranceBase, bhtnCap);

    const socialInsurance = bhxhBase * 0.08;
    const healthInsurance = bhxhBase * 0.015;
    const unemploymentInsurance = bhtnBase * 0.01;
    const totalInsurance =
      socialInsurance + healthInsurance + unemploymentInsurance;

    return {
      socialInsurance,
      healthInsurance,
      unemploymentInsurance,
      totalInsurance,
    };
  }

  private computeTax(taxableIncome: number): number {
    if (taxableIncome <= 0) return 0;
    for (const b of this.TAX_BRACKETS) {
      if (taxableIncome <= b.upTo) {
        return Math.max(0, taxableIncome * b.rate - b.sub);
      }
    }
    return 0;
  }

  private computeFromGross(
    gross: number,
    dependents: number,
    region: SalaryRegion,
    insuranceSalary?: number,
  ) {
    const insuranceBase = insuranceSalary ?? gross;
    const ins = this.computeInsurance(insuranceBase, region);

    const personalDeduction = this.PERSONAL_DEDUCTION;
    const dependentDeduction = dependents * this.DEPENDENT_DEDUCTION;
    const deductions =
      personalDeduction + dependentDeduction + ins.totalInsurance;

    const taxableIncome = Math.max(0, gross - deductions);
    const personalIncomeTax = this.computeTax(taxableIncome);

    const net = gross - ins.totalInsurance - personalIncomeTax;

    return {
      gross: this.round(gross),
      net: this.round(net),
      personalIncomeTax: this.round(personalIncomeTax),
      socialInsurance: this.round(ins.socialInsurance),
      healthInsurance: this.round(ins.healthInsurance),
      unemploymentInsurance: this.round(ins.unemploymentInsurance),
      totalInsurance: this.round(ins.totalInsurance),
      taxableIncome: this.round(taxableIncome),
      deductions: {
        personal: personalDeduction,
        dependents: dependentDeduction,
        insurance: this.round(ins.totalInsurance),
        total: this.round(deductions),
      },
      meta: { region, dependents },
    };
  }

  /**
   * Iteratively converge net → gross. Inverse of progressive tax + insurance.
   */
  private netToGross(
    targetNet: number,
    dependents: number,
    region: SalaryRegion,
    insuranceSalary?: number,
  ): number {
    let lo = targetNet;
    let hi = targetNet * 2 + 50_000_000;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const r = this.computeFromGross(mid, dependents, region, insuranceSalary);
      if (Math.abs(r.net - targetNet) < 1) return mid;
      if (r.net < targetNet) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  private round(n: number): number {
    return Math.round(n);
  }
}
