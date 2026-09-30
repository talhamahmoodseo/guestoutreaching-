const path=require('node:path');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'vendor-entry.js')],bundle:true,format:'iife',globalName:'PublisherDeps',target:'chrome120',outfile:path.join(__dirname,'../extension/vendor/publisher-deps.js'),minify:true,legalComments:'eof'});
