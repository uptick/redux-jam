var path = require( 'path' );
var webpack = require( 'webpack' );

module.exports = {
  context: path.resolve( __dirname + '/..' ),
  entry: [
    'babel-polyfill',
    './src/index'
  ],
  output: {
    path: path.resolve( './lib/' ),
    libraryTarget: 'umd',
    filename: 'index.js'
  },
  module: {
    loaders: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loaders: [ 'babel' ]
      },
      {
        test: /\.styl$/,
        loaders: [
          'style',
          'css',
          'stylus'
        ]
      },
      {
        test: /(node_modules|static)\/.*\.css$/,
        loaders: [
          'style',
          'css'
        ]
      },
      {
        test: /\.css$/,
        exclude: /(node_modules|static)\//,
        loaders: [
          'style',
          'css?modules&importLoaders=1&localIdentName=[path]__[name]__[local]__[hash:base64:5]'
        ]
      },
      {
        test: /\.(woff2?|eot|ttf|svg|otf)(\?.+)?$/,
        loaders: [
          'url'
        ]
      }
    ]
  },
  resolve: {
    modulesDirectories: [ 'node_modules' ],
    extensions: [ '', '.js', '.jsx' ]
  }
};
