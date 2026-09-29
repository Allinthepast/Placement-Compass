/* Placement Compass private per-account sync. Public publishable key only; RLS is enforced in Supabase. */
(function () {
'use strict';
var URL='https://usyebuiyatafpnenbgsr.supabase.co';
var KEY='sb_publishable_235pT3PtEzEjpBxoPFtYOA_JtqILEVM';
var LINK='placementCompass.cloudUser';
var BASE='placementCompass.cloudBase.';
var db=null, user=null, linked=false, cloudExists=false, working=false, queued=false, timer=null, channel=null;
var status='Local only · your current records remain on this device.', conflicts=[];
function el(){return document.getElementById('syncArea');}
function bridge(){return window.CompassBridge;}
function copy(x){return JSON.parse(JSON.stringify(x));}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function profile(s){return {settings:s.settings,custom_research:s.customResearch||[],version:s.version||'1.0.7'};}
function getBase(){try{return JSON.parse(localStorage.getItem(BASE+user.id));}catch(e){return null;}}
function saveBase(x){localStorage.setItem(BASE+user.id,JSON.stringify(x));}
function backup(reason){var s=bridge().getState();localStorage.setItem('placementCompass.safety.'+reason+'.'+Date.now(),JSON.stringify(s));}
function note(x){status=x;render();}
function render(){
 var root=el();if(!root)return;
 if(!db){root.innerHTML='<div class="muted">Cloud library unavailable. The local app still works; reconnect to the internet and reopen Compass.</div>';return;}
 if(!user){
 root.innerHTML='<h2>Phone + computer sync</h2><p class="muted">Sign in with the SAME Compass account on both devices. No placement data is uploaded until you choose the starting copy.</p>'+
 '<div class="form-grid"><div class="field"><label>Email</label><input id="syncEmail" type="email" autocomplete="email" placeholder="Your email"></div>'+
 '<div class="field"><label>Password</label><input id="syncPass" type="password" autocomplete="current-password" placeholder="At least 6 characters"></div></div>'+
 '<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" id="syncLogin">Sign in</button><button class="btn ghost" id="syncSignup">Create account</button></div>'+
 '<p class="small muted" id="syncMsg">'+safe(status)+'</p>';
 root.querySelector('#syncLogin').onclick=function(){auth(false);};
 root.querySelector('#syncSignup').onclick=function(){auth(true);};
 return;
 }
 var top='<h2>Phone + computer sync</h2><p class="small muted">Signed in as '+safe(user.email||'your account')+' · '+safe(status)+'</p>';
 if(!linked){
 top+='<p class="muted">'+(cloudExists?'A cloud copy already exists for this account. Download it to this device. Your current local data will be saved as a safety copy first.':'This account has no cloud data yet. On the PHONE containing your existing activity log, export a JSON backup first, then upload that phone as the starting copy.')+'</p>';
 top+='<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">';
 if(!cloudExists)top+='<button class="btn primary" id="syncStart">Upload THIS device as the starting copy</button>';
 if(cloudExists)top+='<button class="btn primary" id="syncJoin">Use cloud copy on this device</button>';
 top+='<button class="btn ghost" id="syncRefresh">Recheck cloud</button><button class="btn ghost" id="syncLogout">Sign out</button></div>';
 } else {
 top+='<p class="muted">Connected. Changes sync when online, on reopening, and approximately every 20 seconds. Anonymised placement notes only; keep identifiable case information in approved LA systems.</p>';
 top+='<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" id="syncNow">Sync now</button><button class="btn ghost" id="syncLogout">Sign out</button></div>';
 if(conflicts.length)top+='<div class="info" style="margin-top:12px">Conflicting changes found in '+conflicts.map(function(x){return safe(x.key);}).join(', ')+'. Both copies have been preserved; resolve before syncing these entries. <button class="btn soft" id="syncResolve">Resolve conflicts</button></div>';
 }
 root.innerHTML=top;
 function on(id,fn){var b=root.querySelector('#'+id);if(b)b.onclick=fn;}
 on('syncStart',startUpload);on('syncJoin',joinCloud);on('syncRefresh',activate);
 on('syncNow',function(){run();});on('syncResolve',resolve);
 on('syncLogout',function(){if(db)db.auth.signOut();});
}
function safe(x){return String(x||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
async function auth(signup){
 var e=document.getElementById('syncEmail'),p=document.getElementById('syncPass');
 var email=(e&&e.value||'').trim(),password=p&&p.value||'';
 if(!email||password.length<6){note('Enter an email and a password of at least six characters.');return;}
 try{
 note('Contacting Supabase…');
 var result=signup?
 await db.auth.signUp({email:email,password:password,options:{emailRedirectTo:location.origin+location.pathname}}):
 await db.auth.signInWithPassword({email:email,password:password});
 if(result.error)throw result.error;
 note(signup&&!result.data.session?'Account created. Check your inbox to confirm your email, then sign in.':'Signed in. Checking your cloud copy…');
 if(result.data.session)activate();
 }catch(e){note('Sign-in: '+e.message);}
}
async function remote(){
 var p=await db.from('compass_profiles').select('settings,custom_research,version').eq('user_id',user.id).maybeSingle();
 if(p.error)throw p.error;
 if(!p.data)return {p:null,days:null};
 var q=await db.from('compass_days').select('day,payload').eq('user_id',user.id).limit(1000);
 if(q.error)throw q.error;
 var out={};q.data.forEach(function(r){out[r.day]=r.payload;});
 return {p:p.data,days:out};
}
async function activate(){
 if(!db)return;
 var session=await db.auth.getSession();
 user=session.data.session&&session.data.session.user||null;
 linked=false;cloudExists=false;conflicts=[];
 if(channel){db.removeChannel(channel);channel=null;}
 if(!user){note('Signed out. Local data remains available.');return;}
 try{
 note('Checking cloud data…');
 var p=await db.from('compass_profiles').select('user_id').eq('user_id',user.id).maybeSingle();
 if(p.error)throw p.error;
 cloudExists=!!p.data;
 linked=cloudExists&&localStorage.getItem(LINK)===user.id&&!!getBase();
 if(linked){subscribe();note('Connected · checking for changes…');run();}
 else note(cloudExists?'Cloud copy found. Choose Use cloud copy on this device.':'No cloud copy yet. Start from the phone containing your records.');
 }catch(e){note('Connection error: '+e.message);}
}
async function writeDays(rows){
 for(var i=0;i<rows.length;i+=75){
 var q=await db.from('compass_days').upsert(rows.slice(i,i+75),{onConflict:'user_id,day'});
 if(q.error)throw q.error;
 }
}
async function writeProfile(x){
 var p=profile(x);
 var q=await db.from('compass_profiles').upsert({user_id:user.id,settings:p.settings,custom_research:p.custom_research,version:p.version,updated_at:new Date().toISOString()},{onConflict:'user_id'});
 if(q.error)throw q.error;
}
function linkedState(s){return {days:copy(s.days),p:copy(profile(s))};}
async function startUpload(){
 if(!user||working)return;
 if(!confirm('Use THIS device as the first cloud copy? Do this on the PHONE with your existing records. Export a JSON backup from Compass Settings first.'))return;
 working=true;
 try{
 note('Uploading the starting copy…');
 var check=await remote();if(check.p)throw Error('Cloud copy already exists. Please download it instead.');
 var s=copy(bridge().getState());backup('before-initial-upload');
 var rows=Object.keys(s.days).map(function(k){return {user_id:user.id,day:k,payload:s.days[k],updated_at:new Date().toISOString()};});
 await writeDays(rows);
 await writeProfile(s);
 saveBase(linkedState(s));localStorage.setItem(LINK,user.id);linked=true;cloudExists=true;
 subscribe();note('Connected · this device is now the cloud starting copy.');
 }catch(e){note('Upload not completed: '+e.message+'. Local records remain safe.');}
 finally{working=false;}
}
async function joinCloud(){
 if(!user||working)return;
 if(!confirm('Use your cloud copy on this device? Your current local records will be saved as a safety copy before replacing this device’s view.'))return;
 working=true;
 try{
 note('Downloading cloud copy…');
 var r=await remote();if(!r.p)throw Error('No cloud copy exists yet.');
 var s=copy(bridge().getState());
 backup('before-cloud-download');
 Object.keys(r.days).forEach(function(k){s.days[k]=r.days[k];});
 s.settings=r.p.settings;s.customResearch=r.p.custom_research;s.version='1.0.7';
 bridge().setState(s);
 saveBase(linkedState(s));localStorage.setItem(LINK,user.id);linked=true;cloudExists=true;
 subscribe();note('Connected · cloud copy downloaded.');
 }catch(e){note('Could not download: '+e.message);}
 finally{working=false;}
}
function subscribe(){
 if(channel)db.removeChannel(channel);
 channel=db.channel('compass-changes-'+user.id)
 .on('postgres_changes',{event:'*',schema:'public',table:'compass_days',filter:'user_id=eq.'+user.id},schedule)
 .on('postgres_changes',{event:'*',schema:'public',table:'compass_profiles',filter:'user_id=eq.'+user.id},schedule)
 .subscribe();
}
function schedule(){
 if(!linked||!user)return;
 if(working){queued=true;return;}
 if(timer)clearTimeout(timer);
 timer=setTimeout(run,950);
}
async function run(){
 if(!linked||!user||!navigator.onLine)return;
 if(working){queued=true;return;}
 var b=getBase();if(!b){linked=false;note('Sync paused: no verified local baseline. Download the cloud copy to reconnect.');return;}
 working=true;queued=false;
 try{
 var r=await remote();if(!r.p)throw Error('Cloud copy unavailable; refusing to overwrite.');
 var atStart=copy(bridge().getState()), next=copy(atStart), baseNext=copy(b);
 var pushes=[], issues=[], pulled=0;
 Object.keys(atStart.days).forEach(function(k){
 var l=atStart.days[k], old=b.days[k], v=Object.prototype.hasOwnProperty.call(r.days,k)?r.days[k]:old;
 var lc=!eq(l,old),rc=!eq(v,old);
 if(lc&&rc&&!eq(l,v)){issues.push({type:'day',key:k,local:copy(l),remote:copy(v)});return;}
 if(lc&&!eq(l,v))pushes.push({user_id:user.id,day:k,payload:l,updated_at:new Date().toISOString()});
 if(!lc&&rc){next.days[k]=copy(v);pulled++;}
 baseNext.days[k]=copy(lc?l:v);
 });
 var lp=profile(atStart),rp=r.p,op=b.p;
 var lpc=!eq(lp.settings,op.settings)||!eq(lp.custom_research,op.custom_research);
 var rpc=!eq(rp.settings,op.settings)||!eq(rp.custom_research,op.custom_research);
 var pushP=false;
 if(lpc&&rpc&&(!eq(lp.settings,rp.settings)||!eq(lp.custom_research,rp.custom_research)))
 issues.push({type:'profile',key:'Settings / research entries',local:copy(lp),remote:copy(rp)});
 else if(lpc&&(!eq(lp.settings,rp.settings)||!eq(lp.custom_research,rp.custom_research)))pushP=true;
 else if(!lpc&&rpc){next.settings=copy(rp.settings);next.customResearch=copy(rp.custom_research);pulled++;}
 if(!issues.some(function(x){return x.type==='profile';}))baseNext.p=copy(lpc?lp:rp);
 if(pushes.length)await writeDays(pushes);
 if(pushP)await writeProfile(atStart);
 var current=bridge().getState(),updated=false;
 Object.keys(next.days).forEach(function(k){
 if(!eq(next.days[k],atStart.days[k])&&eq(current.days[k],atStart.days[k])){current.days[k]=next.days[k];updated=true;}
 else if(!eq(next.days[k],atStart.days[k])&&!eq(current.days[k],atStart.days[k]))queued=true;
 });
 if(!eq(next.settings,atStart.settings)&&eq(current.settings,atStart.settings)){current.settings=next.settings;updated=true;}
 if(!eq(next.customResearch,atStart.customResearch)&&eq(current.customResearch,atStart.customResearch)){current.customResearch=next.customResearch;updated=true;}
 if(updated)bridge().setState(current);
 saveBase(baseNext);
 conflicts=issues;
 note(issues.length?'Sync needs attention: '+issues.length+' conflicting entries; other changes were synced.':
 'Synced · '+(pushes.length+(pushP?1:0))+' uploaded, '+pulled+' downloaded · '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}));
 }catch(e){note('Sync delayed: '+e.message+'. Local changes are retained.');}
 finally{working=false;if(queued){queued=false;schedule();}}
}
async function resolve(){
 if(!conflicts.length||working)return;
 var answer=prompt('Conflicting edits: '+conflicts.map(function(c){return c.key;}).join(', ')+'\nType DEVICE to retain this device’s versions, CLOUD to retain cloud versions, or leave blank to cancel. Both versions will be saved locally before resolving.','');
 if(answer!=='DEVICE'&&answer!=='CLOUD')return;
 working=true;
 try{
 backup('sync-conflicts-before-'+answer.toLowerCase());
 var s=bridge().getState(),b=getBase(),rows=[],needsProfile=false;
 conflicts.forEach(function(c){
 if(c.type==='day'){
 if(answer==='DEVICE'){rows.push({user_id:user.id,day:c.key,payload:s.days[c.key],updated_at:new Date().toISOString()});b.days[c.key]=copy(s.days[c.key]);}
 else{s.days[c.key]=copy(c.remote);b.days[c.key]=copy(c.remote);}
 } else if(answer==='DEVICE'){needsProfile=true;b.p=copy(profile(s));}
 else{s.settings=copy(c.remote.settings);s.customResearch=copy(c.remote.custom_research);b.p=copy(c.remote);}
 });
 if(rows.length)await writeDays(rows);
 if(needsProfile)await writeProfile(s);
 if(answer==='CLOUD')bridge().setState(s);
 saveBase(b);conflicts=[];note('Conflicts resolved; syncing again…');
 }catch(e){note('Conflict resolution failed: '+e.message);}
 finally{working=false;schedule();}
}
function init(){
 if(!window.supabase||!window.supabase.createClient){render();return;}
 db=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 db.auth.onAuthStateChange(function(event){if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(activate,0);});
 activate();
 setInterval(function(){if(linked)run();},20000);
 window.addEventListener('online',schedule);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)schedule();});
}
function pause(){linked=false;conflicts=[];if(user)localStorage.removeItem(LINK);if(channel&&db){db.removeChannel(channel);channel=null;}note('Cloud sync disconnected on this device. Existing cloud records were not deleted.');}
window.CompassSync={init:init,render:render,schedule:schedule,pause:pause};
})();
