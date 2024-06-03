export class Controller {


      BACKEND='../backend/'
      STUDIO = '../studio/'
    ASSETS = 'assets/'

    constructor() {
    }

    setStudioWorkingDirectory= () => {
        return process.env.NODE_ENV==='production'?`${this.STUDIO}dist/`:this.STUDIO
    }


    setPublicFilePath = (name) => {
        return  `${this.setStudioWorkingDirectory()}${process.env.NODE_ENV==='production'?'':'public/'}${name}`
    }

    setPublicDirectoryPath =(name) => {
        return this.setPublicFilePath(name)+'/'
    }

    setAssetFilePath= (name) => {
        return this.setPublicFilePath(`${this.ASSETS}${name}`)
    }

    setAssetDirectoryPath= (name) => {
        return this.setAssetFilePath(name)+'/'
    }
}