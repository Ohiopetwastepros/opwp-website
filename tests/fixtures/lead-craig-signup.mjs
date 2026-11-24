export const leads = {
  weekly:{name:'Jen Example',phone:'+14195550199',dogs:2,frequency:'once_a_week',city:'Perrysburg',zip:'43551',email:'jen@example.test'},
  biweekly:{name:'Jen Example',dogs:2,frequency:'every_other_week',city:'Perrysburg',zip:'43551'},
  monthly:{name:'Mark Example',dogs:1,frequency:'once_a_month',zip:'43537'},
  twice:{name:'Dana Example',dogs:3,frequency:'twice_a_week',city:'Maumee'},
  one:{name:'Tom Example',dogs:2,frequency:'one_time',city:'Holland',email:'tom@example.test'},
};
export const reply=(text,intents=['provide_signup_detail'],extracted={},options={})=>({text,classification:{
  confirms_details:'no',corrections:{},intents,extracted,sentiment:'neutral',needs_owner:false,owner_reason:'none',confidence:1,playbook_topics:[],...options,
}});
const yes=text=>reply(text,['confirm_yes'],{},{confirms_details:'yes'});
const details=[
  reply('123 Maple Lane', ['address_given'],{address:'123 Maple Lane'}),
  reply('jen@example.test',undefined,{email:'jen@example.test'}),
  reply('right if looking from the street',undefined,{gateSide:'right'}),
  reply('unlocked',undefined,{gateLock:'unlocked'}),
  reply('use the trash can',undefined,{disposal:'trash'}),
  reply('they are fine around strangers',undefined,{dogBehavior:'comfortable'}),
  reply('the first week of December',undefined,{startPreference:'the first week of December'}),
];
export const goldenConversations = [
  {name:'Weekly, lean confirm and out-of-order facts',lead:leads.weekly,turns:[
    yes('Yes, that is correct. Just looking for a quote thanks.'),
    reply('yeah that works. haven’t picked up for 2 weeks; 123 Maple Lane, right gate and unlocked', ['confirm_yes','address_given'],
      {lastCleaned:'2 weeks',address:'123 Maple Lane',gateSide:'right',gateLock:'unlocked'},{confirms_details:'yes'}),
    yes('ok sign me up'),
    reply('i want haul away and dogs are good with people',undefined,{disposal:'haul_away',dogBehavior:'comfortable'}),
    details[6],
  ]},
  {name:'Every other week, price and complete setup',lead:leads.biweekly,turns:[
    yes('yep'),yes('sure'),reply('maybe 2 weeks'),yes('lets get set up'),...details,
  ]},
  {name:'One-time request converts to weekly',lead:leads.one,turns:[
    yes('Yes'),reply('honestly like 2 months'),
    reply('ok so what would I pay up front',['question_billing']),
    reply('ok lets do weekly',['accept_weekly_trial'],{},{confirms_details:'yes'}),
    reply('how much',['question_sanitization_price']),reply('no thanks',['decline_step']),
    ...[yes('go ahead'),...details.filter((_,i)=>i!==1)],
  ]},
  {name:'One-time stays one-time',lead:{...leads.one,dogs:1},turns:[
    yes('correct'),reply('about a month'),reply('no just the one time please',['decline_step']),
    yes('yep'),...details.filter((_,i)=>i!==1),
  ]},
  {name:'6 dogs, long gap, nervous dog, full handoff',lead:{...leads.weekly,dogs:6},turns:[
    yes('yes'),yes('ya ok'),reply("ugh probably 6 months, it's bad",['heavy_buildup'],{lastCleaned:'6 months'}),
    reply('maybe, what does it do',['question_sanitization']),yes('sure'),yes('yes please'),
    ...details.filter((_,i)=>i!==1&&i!==5&&i!==6),
    reply('one barks when people open the gate',undefined,{dogBehavior:'nervous'}),
    details[6],
  ]},
];

const lexicalGroups=[
  [['yep','yes','ya ok','correct','sure','sounds good','👍','that works','yup','yes please'],['confirm_yes'],{}],
  [['maybe 2 weeks','2 wks','like two weeks','2 weeks ago','about two weeks','around 2 weeks','been 2 weeks','uh two wks','2 weeks ish','a couple of weeks'],['provide_signup_detail'],{lastCleaned:'two_weeks'}],
  [['ugh 6 months','6mos','around six months','been like 6 months','about 6 months','maybe six mos','never','since summer','a year','last year'],['heavy_buildup'],{lastCleaned:'5_plus'}],
  [['asdfg','??','🙃','blue fridge','what thing','kjsd 8w??','lol ok','😬😬','uhhh','get milk on your way'],['unclear'],{}],
  [['STOP','stop pls','Please unsubscribe','do not text me','STOP and how much','remove me please','don’t contact me','stopall','end','quit'],['stop'],{}],
  [['cash okay','can i pay cash','do u take cash','cash instead','i use cash','could i give you cash','cash payment?','only have cash','i can hand over cash','pay you cash?'],['request_cash'],{}],
  [['can i use a check','take checks?','i write checks','can i send a cheque','check or card','paper check ok?','would a check work','what about checks','paying by check','can Mail a check'],['question_check'],{}],
  [['when can you come','can u do mornings','could you be here at 8','tomorrow work','how early do you come','whats your schedule','can you come today','can u be here noon','Saturday?','what day usually'],['question_service_day'],{}],
  [['sign me up','how do i get started','ok lets get going','let’s start','can we start service','i want to set it up','im in','get us on the schedule','ready to start','want to get this setup'],['ready_to_sign_up'],{}],
  [['is this a bot','is this ai','are you automated','am i texting a robot','is it ai?','bot?','are these auto texts','ai or person?','is this a chatbot','is this an automated reply'],['is_this_ai'],{}],
  [['can i talk to someone','human please','put Craig on','real person?','rather talk to a person','please call me','can an actual person reply','office please','text me personally','can someone reach out'],['request_person'],{}],
];
export const messyMessages=lexicalGroups.flatMap(([messages,intents,extracted])=>messages.map(text=>reply(text,intents,extracted,
  intents[0]==='confirm_yes'?{confirms_details:'yes'}:{})));
