function nonnegative(value:number,label:string,max=100_000_000) {
  if (!Number.isFinite(value)||value<0||value>max) throw new Error("قيمة غير صحيحة: "+label);
  return value;
}
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function calculateHiringCost(input:{monthlySalary:number;monthlyAllowances:number;employerContributionPercent:number;annualInsurance:number;annualPermit:number;oneOffRecruitment:number;headcount:number}) {
  for(const [key,value] of Object.entries(input)) nonnegative(value,key);
  if(!Number.isInteger(input.headcount)||input.headcount<1||input.headcount>10_000) throw new Error("عدد الموظفين بين ١ و١٠٬٠٠٠.");
  if(input.employerContributionPercent>100) throw new Error("نسبة المساهمة بين صفر و١٠٠.");
  const salaryCents=Math.round(input.monthlySalary*100);
  const allowanceCents=Math.round(input.monthlyAllowances*100);
  const contributionCents=Math.round(salaryCents*input.employerContributionPercent/100);
  const annualCents=(salaryCents+allowanceCents+contributionCents)*12+Math.round(input.annualInsurance*100)+Math.round(input.annualPermit*100);
  const firstCents=annualCents+Math.round(input.oneOffRecruitment*100);
  return {monthlyPerEmployee:round(annualCents/1200),annualPerEmployee:annualCents/100,firstYearTotal:firstCents*input.headcount/100,recurringAnnualTotal:annualCents*input.headcount/100};
}

export function calculateSalaryProration(input:{monthlySalary:number;daysInMonth:number;workedDays:number}) {
  nonnegative(input.monthlySalary,"الراتب");
  if(!Number.isInteger(input.daysInMonth)||input.daysInMonth<1||input.daysInMonth>31||!Number.isInteger(input.workedDays)||input.workedDays<0||input.workedDays>input.daysInMonth) throw new Error("تحقق من عدد أيام الفترة وأيام العمل.");
  return {amount:round(Math.round(input.monthlySalary*100)*input.workedDays/input.daysInMonth/100)};
}

export function calculatePercentage(input:{amount:number;percent:number;operation:"add"|"subtract"}) {
  nonnegative(input.amount,"المبلغ");nonnegative(input.percent,"النسبة",100);
  const adjustment=round(input.amount*input.percent/100);
  return {adjustment,total:round(input.amount+(input.operation==="add"?adjustment:-adjustment))};
}

export const COMPLIANCE_CHECKS=[
  {id:"registration",title:"السجل والتراخيص",detail:"هل راجعت تواريخ انتهاء السجل والتراخيص اللازمة لنشاط المنشأة؟",url:"https://business.sa/"},
  {id:"contracts",title:"العقود وبيانات الموظفين",detail:"هل تحققت من تحديث بيانات الموظفين والعقود في ملفات المنشأة؟",url:"https://www.qiwa.sa/"},
  {id:"wages",title:"الأجور والمستندات",detail:"هل توجد مستندات سداد الأجور وتسوية الملاحظات المتاحة لديك؟",url:"https://mudad.com.sa/"},
  {id:"insurance",title:"التأمينات",detail:"هل راجعت بيانات المشتركين والفواتير ذات الصلة؟",url:"https://www.gosi.gov.sa/"},
  {id:"residency",title:"وثائق المقيمين",detail:"هل راجعت صلاحية الوثائق وتواريخ الإجراءات المطلوبة؟",url:"https://muqeem.sa/"},
  {id:"tax",title:"المستندات الضريبية",detail:"هل راجعت المستندات والالتزامات التي تنطبق على منشأتك مع المختص؟",url:"https://zatca.gov.sa/"}
] as const;

export function assessReadiness(answers:Record<string,"yes"|"no"|"unknown">) {
  const total=COMPLIANCE_CHECKS.length;
  const complete=COMPLIANCE_CHECKS.filter(item=>answers[item.id]==="yes").length;
  const followUp=COMPLIANCE_CHECKS.filter(item=>answers[item.id]==="no").length;
  return {complete,followUp,unknown:total-complete-followUp,total,percent:Math.round(complete/total*100)};
}

export const PLATFORM_DIRECTORY=[
  {id:"qiwa",name:"قوى",category:"العمل والموارد البشرية",description:"خدمات العمل وإدارة العلاقة التعاقدية للمنشآت.",url:"https://www.qiwa.sa/"},
  {id:"muqeem",name:"مقيم",category:"الإقامة والتأشيرات",description:"بوابة خدمات المقيمين للمنشآت.",url:"https://muqeem.sa/"},
  {id:"mudad",name:"مدد",category:"الأجور",description:"إدارة الأجور والعمليات المرتبطة بها.",url:"https://mudad.com.sa/"},
  {id:"gosi",name:"التأمينات الاجتماعية",category:"التأمينات",description:"الخدمات الإلكترونية للمشتركين وأصحاب العمل.",url:"https://www.gosi.gov.sa/"},
  {id:"absher",name:"أبشر",category:"الإقامة والتأشيرات",description:"بوابة الخدمات الإلكترونية للأفراد والأعمال.",url:"https://www.absher.sa/"},
  {id:"business",name:"المركز السعودي للأعمال",category:"التجارة والتراخيص",description:"خدمات بدء وممارسة وإنهاء الأعمال الاقتصادية.",url:"https://business.sa/"},
  {id:"commerce",name:"وزارة التجارة",category:"التجارة والتراخيص",description:"خدمات ومعلومات السجلات والأعمال التجارية.",url:"https://mc.gov.sa/"},
  {id:"balady",name:"بلدي",category:"التجارة والتراخيص",description:"الخدمات البلدية والتراخيص ذات الصلة.",url:"https://balady.gov.sa/"},
  {id:"zatca",name:"الزكاة والضريبة والجمارك",category:"الزكاة والضريبة",description:"الخدمات والمراجع المتعلقة بالزكاة والضرائب والجمارك.",url:"https://zatca.gov.sa/"},
  {id:"hrsd",name:"الموارد البشرية والتنمية الاجتماعية",category:"العمل والموارد البشرية",description:"الأنظمة والقرارات والخدمات الرسمية للوزارة.",url:"https://www.hrsd.gov.sa/"}
] as const;
