module.exports = {
  entry: "./src/main.ts",
  
  // webpack 5 继续需要指定模式
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  
  output: {
    filename: "./main.js",
    pathinfo: false,
    // webpack 5: libraryTarget 语法更新
    library: {
      type: "commonjs2"
    },
    devtoolModuleFilenameTemplate: '[resource-path]',
  },

  target: "node",

  // webpack 5: node 配置简化，移除了一些选项
  node: {
    global: true,
    __filename: false,
    __dirname: false,
  },

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: ['.js', '.ts', '.d.ts', '.tsx']
  },

  externals: [
    {
        // webpack will not try to rewrite require("main.js.map")
        "main.js.map": "./main.js.map",
    },
  ],

  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
      { 
        test: /\.tsx?$/, 
        use: 'ts-loader' 
      },
      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { 
        test: /\.js$/, 
        use: 'source-map-loader',
        enforce: 'pre'
      }
    ]
  },
  
  // webpack 5: 继续支持 devtool
  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map',
  
  // webpack 5: 可选的持久化缓存配置（提升构建性能）
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename]
    }
  },
};
