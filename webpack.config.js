const path = require('path');
const fs = require('fs');
const marked = require('marked');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const templatesDir = path.resolve(__dirname, 'src') + '/templates/';
const postsDir = path.resolve(__dirname, 'src') + '/posts/';
const htmlDir = path.resolve(__dirname, 'src') + '/html/';

const postsUrl = 'post/';

const postUrlForFilename = (filename) => postsUrl +
  filename.replace(/\.md$/, '.html');

const splitArticle = (markdown) => {
  const titleSplitIndex = markdown.indexOf('\n');
  const title = markdown.substr(0, titleSplitIndex);
  const dateSplitIndex = markdown.indexOf('\n', titleSplitIndex + 1);
  const date = markdown.substr(titleSplitIndex,
      dateSplitIndex - titleSplitIndex);
  const body = markdown.substr(dateSplitIndex, markdown.length);
  const htmlContent = marked(body);
  const cutIndex = htmlContent.indexOf('<cut>');
  return {
    title,
    date,
    htmlContent,
    cutIndex,
  };
};

let posts = [];

const markdownFiles = fs.readdirSync(postsDir).filter(
    (filename) => filename.endsWith('.md')).sort();

const markdownPlugins = markdownFiles.map((filename) => {
  const filePath = postsDir + filename;
  const fileContents = fs.readFileSync(filePath, 'UTF-8');
  const outputLink = postUrlForFilename(filename);
  const {
    title,
    date,
    htmlContent,
    cutIndex,
  } = splitArticle(fileContents);

  const htmlContentPreCut = cutIndex === -1 ? htmlContent
                                            : htmlContent.substr(0, cutIndex);

  posts.push({
    title,
    date,
    htmlContentPreCut,
    uri: outputLink,
    cut: cutIndex !== -1,
  });

  return new HtmlWebpackPlugin({
    filename: outputLink,
    inject: false,
    template: templatesDir + 'markdown.html',
    templateParameters: {
      title,
      date,
      htmlContent,
    },
  });
});

const htmlFiles = fs.readdirSync(htmlDir)
    .filter((filename) => filename.endsWith('.html'));
const htmlPlugins = htmlFiles.map((filename) => new HtmlWebpackPlugin({
  filename: filename,
  inject: false,
  template: htmlDir + filename,
}));


const indexPlugin = new HtmlWebpackPlugin({
    filename: 'index.html',
    inject: false,
    template: templatesDir + 'index.html',
    templateParameters: {
      title: 'AFakeman\'s blog',
      posts,
    },
});

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: [
    ...htmlPlugins,
    ...markdownPlugins,
    indexPlugin,
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['file-loader'],
      },
    ],
  },
};
