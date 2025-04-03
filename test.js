(async()=>{

  await new Promise(r=>setTimeout(r,10_000));
  console.log("log");
  console.error("err");

})();

process.on("exit", ()=>console.log("end"));
