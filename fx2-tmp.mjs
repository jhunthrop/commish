const h2r=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const L=h=>{const[r,g,b]=h2r(h);return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);};
const R=(a,b)=>(Math.max(L(a),L(b))+0.05)/(Math.min(L(a),L(b))+0.05);
const hsl=(h,s,l)=>{s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
 const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
 const t=v=>Math.round(v*255).toString(16).padStart(2,'0');
 return `#${t(f(0))}${t(f(8))}${t(f(4))}`.toUpperCase();};
const DS=['#05070C','#0B1019','#101724','#0A0F17'], LS=['#F4F5F7','#FAFBFC','#FFFFFF','#E8EBEF'];
const mn=(c,G)=>Math.min(...G.map(g=>+R(c,g).toFixed(2)));
const ok=(c,G,n)=>G.every(g=>R(c,g)>=n);

console.log('A. negative must sit 1.5x from live (they were 1.33 apart — a real flaw)');
for(const l of [72,75,78,80]){const c=hsl(8,100,l);
  console.log(`   dark negative ${c}  surfaces ${mn(c,DS)}  vs live#FF2D2D ${R(c,'#FF2D2D').toFixed(2)}  vs positive#00E5FF ${R(c,'#00E5FF').toFixed(2)}`);}
for(const l of [38,34,30]){const c=hsl(8,72,l);
  console.log(`   light negative ${c}  surfaces ${mn(c,LS)}  vs live#C91616 ${R(c,'#C91616').toFixed(2)}`);}

console.log('\nB. te/k/def sticker plates, pairwise >=1.5');
const dset={te:hsl(205,60,18), k:hsl(215,6,34), def:hsl(215,12,10)};
console.log('   dark ', JSON.stringify(dset), ` te/k ${R(dset.te,dset.k).toFixed(2)} te/def ${R(dset.te,dset.def).toFixed(2)} k/def ${R(dset.k,dset.def).toFixed(2)}`);
const lset={te:hsl(205,55,86), k:hsl(215,5,96), def:hsl(215,14,74)};
console.log('   light', JSON.stringify(lset), ` te/k ${R(lset.te,lset.k).toFixed(2)} te/def ${R(lset.te,lset.def).toFixed(2)} k/def ${R(lset.k,lset.def).toFixed(2)}`);

console.log('\nC. tier plates: >=3:1 on surface+elevated, label >=4.5 on plate, B/C separable');
const dG=[DS[0],DS[1]], lG=[LS[0],LS[1]];
const dT={S:'#FFB627',A:'#B9C2D0',B:hsl(215,14,52),C:hsl(215,10,38)};
for(const [g,c] of Object.entries(dT)){
  const w=R('#FFFFFF',c), k=R('#0A0D12',c);
  console.log(`   dark ${g} ${c}  onGround ${mn(c,dG)}  white ${w.toFixed(2)}  black ${k.toFixed(2)}  -> label ${w>=4.5?'white':k>=4.5?'black':'NEITHER'}`);}
console.log(`   dark B/C separable ${R(dT.B,dT.C).toFixed(2)}`);
const lT={S:'#9D5707',A:hsl(215,16,38),B:hsl(215,14,55),C:hsl(215,10,68)};
for(const [g,c] of Object.entries(lT)){
  const w=R('#FFFFFF',c), k=R('#0A0D12',c);
  console.log(`   light ${g} ${c}  onGround ${mn(c,lG)}  white ${w.toFixed(2)}  black ${k.toFixed(2)}  -> label ${w>=4.5?'white':k>=4.5?'black':'NEITHER'}`);}
console.log(`   light B/C separable ${R(lT.B,lT.C).toFixed(2)}`);
