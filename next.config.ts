import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-forge e xml-crypto usam APIs do Node; ficam fora do bundle do servidor.
  serverExternalPackages: ["node-forge", "xml-crypto", "@xmldom/xmldom", "exceljs"],
  poweredByHeader: false,
};

export default nextConfig;
