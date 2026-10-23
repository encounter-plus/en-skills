// All recipient IDs below are synthetic fixtures.
import test from 'node:test';import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {authoringBinding} from '../src/authoring-api.ts';
import {parseLegacyRecipientOptions,resolveLegacyRecipient,legacyRecipientKind,legacyRecipientFields} from '../src/legacy-recipients.ts';
test('recipient IDs stay opaque until scoped individual game evidence establishes users',()=>{
 const binding=authoringBinding('tech.en.cx',42,'recipients'),page={status:200,url:'https://tech.en.cx/GameDetails.aspx?gid=42',html:'<table><tr><td>\u0418\u0433\u0440\u0430\u0435\u043c:</td><td>\u0412 \u043e\u0434\u0438\u043d\u043e\u0447\u043a\u0443</td></tr></table>'};
 assert.equal(legacyRecipientKind(page,binding),'user');assert.equal(legacyRecipientKind({...page,url:page.url.replace('42','43')},binding),'unknown');
 const select=parseFragment('<select><option value="0">All</option><option value="900077">Native user</option><optgroup disabled><option value="999">Disabled</option></optgroup></select>').childNodes[0],options=parseLegacyRecipientOptions(select);
 assert.equal(options.length,2);assert.equal(resolveLegacyRecipient({for_user_id:900077},options,0,'user'),900077);assert.throws(()=>resolveLegacyRecipient({for_user_id:900077},options,0),{code:'unsupported'});assert.throws(()=>resolveLegacyRecipient({for_member_id:900077,for_user_id:0},options,0,'user'),{code:'unsupported'});assert.throws(()=>resolveLegacyRecipient({for_member_id:999},options,0),{code:'unsupported'});
 assert.equal(legacyRecipientFields(900077,options,'user').for_user_id,900077);assert.equal(legacyRecipientFields(900077,options).for_user_id,undefined);
});
