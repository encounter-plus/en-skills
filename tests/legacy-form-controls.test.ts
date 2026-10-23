import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {extraForm} from '../src/legacy-extra-form.ts';
import {parseLegacyGameForm} from '../src/legacy-game.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque');
const selects=`<select name="default"><option disabled value="bad">Bad</option><optgroup disabled><option value="also-bad">Bad group</option></optgroup><option value="good">Good</option></select><select name="last"><option selected value="first">First</option><option selected value="last">Last</option></select><select name="multi" multiple><option selected value="good">Good</option><optgroup disabled><option selected value="bad">Bad</option></optgroup></select>`;
test('repaired extra form uses lexical ownership and browser select successful-control semantics',()=>{
 const path='/Administration/Games/NameCommentEdit.aspx?gid=42&level=2',html=`<input type="hidden" name="outside" value="foreign"><table><form method="post"><tr><td><input name="txtLevelName" value="Name"><textarea name="txtLevelComment">Comment</textarea>${selects}<input type="hidden" name="inside" value="preserve"><input type="image" name="btnUpdate"></td></tr></form></table><input type="hidden" name="after" value="foreign">`;
 const form=extraForm({status:200,url:'https://tech.en.cx'+path,html},binding,path,['txtLevelName','txtLevelComment'],name=>name==='btnUpdate','/Administration/Games/NameCommentEdit.aspx'),controls=new URLSearchParams(form.controls);
 assert.equal(controls.get('default'),'good');assert.equal(controls.get('last'),'last');assert.deepEqual(controls.getAll('multi'),['good']);assert.equal(controls.get('inside'),'preserve');assert.equal(controls.has('outside'),false);assert.equal(controls.has('after'),false);
});
test('full game form selects first enabled option and ignores inherited disabled group values',()=>{
 const html=`<form method="post" action="/Administration/Games/GameEditor.aspx"><input type="hidden" name="gid" value="42"><input type="hidden" name="action" value="update"><input name="GameTitle" value="Game"><textarea name="Descr">Literal</textarea>${selects}<input type="image" name="btnUpdate"></form>`;
 const form=parseLegacyGameForm({status:200,url:'https://tech.en.cx/Administration/Games/GameEditor.aspx?gid=42&action=edit',html},binding),controls=new URLSearchParams(form.controls);
 assert.equal(controls.get('default'),'good');assert.equal(controls.get('last'),'last');assert.deepEqual(controls.getAll('multi'),['good']);
});
