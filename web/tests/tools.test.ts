import {describe,expect,it} from "vitest";
import {assessReadiness,calculateHiringCost,calculatePercentage,calculateSalaryProration} from "../src/lib/tools";
import {employeeSchema,isoDate,profileSchema} from "../src/lib/server/business-schemas";

describe("transparent cost calculations",()=>{
  it("separates recurring and once-only costs for all employees",()=>{
    const result=calculateHiringCost({monthlySalary:8000,monthlyAllowances:2000,employerContributionPercent:10,annualInsurance:2400,annualPermit:1200,oneOffRecruitment:5000,headcount:3});
    expect(result).toEqual({monthlyPerEmployee:11100,annualPerEmployee:133200,firstYearTotal:414600,recurringAnnualTotal:399600});
  });
  it("does not invent statutory contributions or fixed fees",()=>{
    expect(calculateHiringCost({monthlySalary:1000,monthlyAllowances:0,employerContributionPercent:0,annualInsurance:0,annualPermit:0,oneOffRecruitment:0,headcount:1}).annualPerEmployee).toBe(12000);
  });
  it("rejects nonfinite and fractional headcount",()=>{
    for(const headcount of [0,1.5,10001,Infinity]) expect(()=>calculateHiringCost({monthlySalary:1000,monthlyAllowances:0,employerContributionPercent:0,annualInsurance:0,annualPermit:0,oneOffRecruitment:0,headcount})).toThrow();
  });
  it("uses explicitly selected days and rounds currency",()=>{
    expect(calculateSalaryProration({monthlySalary:10000,daysInMonth:31,workedDays:13}).amount).toBe(4193.55);
    expect(()=>calculateSalaryProration({monthlySalary:1000,daysInMonth:30,workedDays:31})).toThrow();
    expect(calculatePercentage({amount:199.95,percent:15,operation:"add"})).toEqual({adjustment:29.99,total:229.94});
  });
});
describe("evidence rather than official compliance certification",()=>{
  it("counts unknown evidence as incomplete",()=>expect(assessReadiness({registration:"yes",tax:"no"})).toEqual({complete:1,followUp:1,unknown:4,total:6,percent:17}));
});
describe("business input boundaries",()=>{
  it("rejects impossible calendar dates",()=>{
    expect(isoDate.safeParse("2027-02-29").success).toBe(false);
    expect(isoDate.safeParse("2028-02-29").success).toBe(true);
    expect(isoDate.safeParse("2026-13-01").success).toBe(false);
  });
  it("does not accept a client-controlled tenant or privileged field",()=>{
    expect(employeeSchema.safeParse({name:"موظف",job:"أخصائي",nationality:"saudi",monthlySalary:8000,tenant_id:"other"}).success).toBe(false);
    expect(profileSchema.safeParse({name:"شركة",registration:"",activity:"",city:"",email:"",phone:"",role:"super_admin"}).success).toBe(false);
  });
});
