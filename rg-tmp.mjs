const h2r=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const L=h=>{const[r,g,b]=h2r(h);return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);};
const R=(a,b)=>(Math.max(L(a),L(b))+0.05)/(Math.min(L(a),L(b))+0.05);
const over=(f,b,a)=>{const F=h2r(f),B=h2r(b);return '#'+F.map((v,i)=>Math.round(v*a+B[i]*(1-a)).toString(16).padStart(2,'0')).join('').toUpperCase();};
const hsl=(h,s,l)=>{s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
 const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
 const t=v=>Math.round(v*255).toString(16).padStart(2,'0');
 return `#${t(f(0))}${t(f(8))}${t(f(4))}`.toUpperCase();};
const DS=['#05070C','#0B1019','#101724','#0A0F17'], LS=['#F4F5F7','#FAFBFC','#FFFFFF','#E8EBEF'];
const mn=(c,G)=>Math.min(...G.map(g=>+R(c,g).toFixed(2)));

console.log('== DARK: live fixed #FF3D3D (5.12). neg red >=1.5x live; pos green >=1.5x neg; all >=4.5 ==');
let best=null;
for(let nl=60;nl<=85;nl+=0.5){const neg=hsl(4,90,nl); if(mn(neg,DS)<4.5)continue;
 const rNegLive=R(neg,'#FF3D3D'); if(rNegLive<1.5)continue;
 for(let pl=55;pl<=90;pl+=0.5){const pos=hsl(145,65,pl); if(mn(pos,DS)<4.5)continue;
  const gap=R(pos,DS[2])/R(neg,DS[2]); if(gap<1.5)continue;
  const score=Math.abs(gap-1.7)+Math.abs(rNegLive-1.7);
  if(!best||score<best.score)best={pos,neg,gap:+gap.toFixed(2),nl:+rNegLive.toFixed(2),score,pm:mn(pos,DS),nm:mn(neg,DS)};
 }}
console.log(best? ` pos ${best.pos} (${best.pm})  neg ${best.neg} (${best.nm})  pos/neg ${best.gap}  neg/live ${best.nl}`:' none');

console.log('\n== LIGHT: live #C81616 (4.90). same chain downward ==');
let bl=null;
for(let nl=14;nl<=30;nl+=0.5){const neg=hsl(4,75,nl); if(mn(neg,LS)<4.5)continue;
 if(R(neg,over(neg,LS[0],0.10))<4.5)continue;
 const rNegLive=R('#C81616',LS[3])>R(neg,LS[3])?R(neg,LS[3])/R('#C81616',LS[3]):R(neg,LS[3])/R('#C81616',LS[3]);
 const ratio=R(neg,LS[3])/R('#C81616',LS[3]); if(ratio<1.5)continue;
 for(let pl=4;pl<=20;pl+=0.5){const pos=hsl(158,90,pl); if(mn(pos,LS)<4.5)continue;
  const gap=R(pos,LS[3])/R(neg,LS[3]); if(gap<1.4)continue;
  const score=Math.abs(gap-1.5)+Math.abs(ratio-1.6);
  if(!bl||score<bl.score)bl={pos,neg,gap:+gap.toFixed(2),nl:+ratio.toFixed(2),score,pm:mn(pos,LS),nm:mn(neg,LS)};
 }}
console.log(bl? ` pos ${bl.pos} (${bl.pm})  neg ${bl.neg} (${bl.nm})  pos/neg ${bl.gap}  neg/live ${bl.nl}`:' none — relax');

console.log('\n== MAGNITUDE re-hue: greens down to reds, strictly decreasing ==');
const aim=(h,s,g,t)=>{let b=null;for(let l=1;l<99;l+=0.25){const c=hsl(h,s,l),d=Math.abs(R(c,g)-t);if(!b||d<b.d)b={c,d,r:+R(c,g).toFixed(2)};}return b;};
const dm={strong:aim(145,70,DS[2],11.7),good:aim(145,40,DS[2],9.0),weak:aim(10,80,DS[2],7.0),bad:aim(4,85,DS[2],5.2)};
for(const[k,v]of Object.entries(dm))console.log(` dark ${k.padEnd(7)} ${v.c} ${v.r}`);
const lm={strong:aim(158,90,LS[3],8.3),good:aim(158,50,LS[3],6.6),weak:aim(10,60,LS[3],5.6),bad:aim(4,72,LS[3],4.6)};
for(const[k,v]of Object.entries(lm))console.log(` light ${k.padEnd(7)} ${v.c} ${v.r}`);
console.log('\n on-fill labels: negText on dark neg', best?R('#1A0303',best.neg).toFixed(2):'-', '| light neg white', bl?R('#FFFFFF',bl.neg).toFixed(2):'-', '| dark pos ink', best?R('#04120A',best.pos).toFixed(2):'-');
