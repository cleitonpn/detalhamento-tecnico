const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing')
const {doc,setDoc,getDoc}=require('firebase/firestore')
const {ref,uploadBytes,getBytes}=require('firebase/storage')
let env
const hash='a'.repeat(64),filename=`${hash}.glb`,path=`dt_workspaces/team_a/projects/project_a/models/${filename}`
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-detalhamento',firestore:{rules:readFileSync('firebase/firestore.rules','utf8')},storage:{rules:readFileSync('firebase/storage.rules','utf8')}})
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore()
    await setDoc(doc(db,'dt_workspaces/team_a/members/alice'),{active:true,role:'editor'})
    await setDoc(doc(db,'dt_workspaces/team_a/members/viewer'),{active:true,role:'viewer'})
    await setDoc(doc(db,'dt_workspaces/team_a/members/disabled'),{active:false,role:'owner'})
    await setDoc(doc(db,'dt_workspaces/team_b/members/bob'),{active:true,role:'owner'})
    await setDoc(doc(db,'dt_workspaces/team_a/projects/project_a'),{name:'Projeto A'})
    await setDoc(doc(db,'dt_workspaces/team_a/projects/project_a/revisions/1'),{name:'Rev 1'})
    await setDoc(doc(db,`dt_workspaces/team_a/uploads/project_a_${filename}`),{uid:'alice',bytes:12,expiresAtMs:Date.now()+3600000})
    await setDoc(doc(db,`dt_workspaces/team_a/uploads/project_a_${hash}.dwg`),{uid:'alice',bytes:12,expiresAtMs:Date.now()+3600000})
    await setDoc(doc(db,`dt_workspaces/team_a/uploads/project_a_${hash}.exe`),{uid:'alice',bytes:12,expiresAtMs:Date.now()+3600000})
  })
})
after(async()=>{await env?.cleanup()})
test('leitura restrita à equipe; clientes não alteram dados nem revisões diretamente',async()=>{
  const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore(),guest=env.unauthenticatedContext().firestore()
  await assertSucceeds(getDoc(doc(alice,'dt_workspaces/team_a/projects/project_a')))
  await assertFails(getDoc(doc(bob,'dt_workspaces/team_a/projects/project_a')))
  await assertFails(getDoc(doc(guest,'dt_workspaces/team_a/projects/project_a')))
  await assertFails(setDoc(doc(alice,'dt_workspaces/team_a/projects/project_a'),{name:'Mudança direta'}))
  await assertFails(setDoc(doc(alice,'dt_workspaces/team_a/projects/project_a/revisions/1'),{name:'Mudança histórica'}))
  await assertFails(getDoc(doc(env.authenticatedContext('disabled').firestore(),'dt_workspaces/team_a/projects/project_a')))
})
test('upload reservado é imutável, exige proprietário da reserva e não atravessa equipes',async()=>{
  const alice=env.authenticatedContext('alice').storage(),bob=env.authenticatedContext('bob').storage(),viewer=env.authenticatedContext('viewer').storage()
  const bytes=new Uint8Array(12),metadata={contentType:'model/gltf-binary'}
  await assertFails(uploadBytes(ref(viewer,path),bytes,metadata))
  await assertFails(uploadBytes(ref(bob,path),bytes,metadata))
  await assertFails(uploadBytes(ref(alice,path),new Uint8Array(13),metadata))
  await assertSucceeds(uploadBytes(ref(alice,path),bytes,metadata))
  await assertFails(uploadBytes(ref(alice,path),bytes,metadata))
  assert.equal((await assertSucceeds(getBytes(ref(viewer,path)))).byteLength,12)
  await assertFails(getBytes(ref(bob,path)))
  await assertFails(uploadBytes(ref(alice,`dt_workspaces/team_b/projects/project_a/models/${filename}`),bytes,metadata))
})

test('DWG reservado aceita só o tipo de conteúdo do DWG; extensões fora da lista são recusadas',async()=>{
  const alice=env.authenticatedContext('alice').storage(),bytes=new Uint8Array(12)
  const dwg=`dt_workspaces/team_a/projects/project_a/models/${hash}.dwg`
  await assertFails(uploadBytes(ref(alice,dwg),bytes,{contentType:'model/gltf-binary'}))
  await assertSucceeds(uploadBytes(ref(alice,dwg),bytes,{contentType:'image/vnd.dwg'}))
  await assertFails(uploadBytes(ref(alice,`dt_workspaces/team_a/projects/project_a/models/${hash}.exe`),bytes,{contentType:'application/octet-stream'}))
})
