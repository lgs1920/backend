export class Controller {

    // Relative path from api to studio and vice versa
    BACKEND='../backend/'
    // In production we are in dist... so ../.. instead of ..
    STUDIO = `../${process.env.NODE_ENV === 'production' ? '../' : ''}studio/`
    ASSETS = 'assets/'

    constructor() {
    }

    setStudioWorkingDirectory= () => {
        return process.env.NODE_ENV==='production'?`${this.STUDIO}dist/`:this.STUDIO
    }


    setPublicFilePath = (name) => {
        return `${this.setStudioWorkingDirectory()}${process.env.NODE_ENV === 'production' ? '/' : 'public/'}${name}`
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