const {createClient}=require('@supabase/supabase-js');
const {createHandler}=require('../notifications.cjs');
let handler;
module.exports=async(req,res)=>{
  if(!handler) {
    const url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
    handler=createHandler({client:url && secret ? createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}) : null,centralOrigin:process.env.CENTRAL_ORIGIN});
  }
  return handler(req,res);
};
